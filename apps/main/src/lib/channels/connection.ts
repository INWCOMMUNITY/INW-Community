import { prisma } from "database";
import { encrypt, decrypt } from "@/lib/encrypt";
import { getAdapter } from "./registry";
import type { ChannelConnectionContext, ChannelProvider } from "./types";
import { logSyncEvent } from "./sync-log";
import { EbayApiError, needsTokenRefresh } from "./ebay/errors";
import { EtsyApiError } from "./etsy/client";
import { notifyChannelDisconnectIfNew } from "./channel-disconnect-notify";

/** Refresh before the token's last 5 minutes so the channel cron never starts on a dying token. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

type ConnectionRow = {
  id: string;
  memberId: string;
  provider: string;
  externalShopId: string | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  status: string;
  etsyShippingProfileId: string | null;
  config?: unknown;
};

/**
 * Resolve a usable connection context: decrypt the access token, refreshing (and re-encrypting)
 * it first if it is expired or about to expire. Returns null if the connection cannot be used.
 */
export async function getConnectionContext(
  connection: ConnectionRow
): Promise<ChannelConnectionContext | null> {
  if (connection.status === "disconnected" || !connection.accessTokenEncrypted) return null;

  let accessToken: string;
  try {
    accessToken = decrypt(connection.accessTokenEncrypted);
  } catch (e) {
    const errMsg =
      "Stored channel tokens could not be decrypted. Disconnect and reconnect in Sync Stores.";
    await prisma.channelConnection
      .update({
        where: { id: connection.id },
        data: { status: "error", lastError: errMsg },
      })
      .catch(() => {});
    logSyncEvent(connection.memberId, connection.provider, "token_expired", errMsg);
    void notifyChannelDisconnectIfNew({
      memberId: connection.memberId,
      provider: connection.provider,
      previousStatus: connection.status,
    }).catch(() => {});
    return null;
  }

  const expiresAt = connection.tokenExpiresAt?.getTime();
  const expired =
    expiresAt == null
      ? Boolean(connection.refreshTokenEncrypted)
      : expiresAt - REFRESH_SKEW_MS < Date.now();
  if (expired && !connection.refreshTokenEncrypted) {
    const errMsg = "Channel access token expired with no refresh token. Reconnect in Sync Stores.";
    await prisma.channelConnection
      .update({
        where: { id: connection.id },
        data: { status: "error", lastError: errMsg },
      })
      .catch(() => {});
    logSyncEvent(connection.memberId, connection.provider, "token_expired", errMsg);
    void notifyChannelDisconnectIfNew({
      memberId: connection.memberId,
      provider: connection.provider,
      previousStatus: connection.status,
    }).catch(() => {});
    return null;
  }
  if (expired && connection.refreshTokenEncrypted) {
    try {
      const refreshToken = decrypt(connection.refreshTokenEncrypted);
      const adapter = getAdapter(connection.provider as ChannelProvider);
      const tokens = await adapter.refreshAccessToken(refreshToken);
      accessToken = tokens.accessToken;
      await prisma.channelConnection.update({
        where: { id: connection.id },
        data: {
          accessTokenEncrypted: encrypt(tokens.accessToken),
          ...(tokens.refreshToken
            ? { refreshTokenEncrypted: encrypt(tokens.refreshToken) }
            : {}),
          tokenExpiresAt: tokens.expiresInSec
            ? new Date(Date.now() + tokens.expiresInSec * 1000)
            : null,
          status: "active",
          lastError: null,
        },
      });
      logSyncEvent(connection.memberId, connection.provider, "token_refreshed");
    } catch (e) {
      const errMsg = String(e).slice(0, 500);
      await prisma.channelConnection
        .update({
          where: { id: connection.id },
          data: { status: "error", lastError: errMsg },
        })
        .catch(() => {});
      logSyncEvent(
        connection.memberId,
        connection.provider,
        "token_expired",
        `Token refresh failed: ${errMsg}`
      );
      void notifyChannelDisconnectIfNew({
        memberId: connection.memberId,
        provider: connection.provider,
        previousStatus: connection.status,
      }).catch(() => {});
      return null;
    }
  }

  return {
    id: connection.id,
    memberId: connection.memberId,
    provider: connection.provider as ChannelProvider,
    externalShopId: connection.externalShopId,
    accessToken,
    etsyShippingProfileId: connection.etsyShippingProfileId,
    config:
      connection.config && typeof connection.config === "object"
        ? (connection.config as Record<string, unknown>)
        : null,
  };
}

export async function getMemberConnectionContext(
  memberId: string,
  provider: ChannelProvider
): Promise<ChannelConnectionContext | null> {
  const conn = await prisma.channelConnection.findUnique({
    where: { memberId_provider: { memberId, provider } },
  });
  if (!conn || conn.status === "disconnected") return null;
  return getConnectionContext(conn);
}

/** Like getMemberConnectionContext but returns a user-facing error when the row exists but tokens are unusable. */
export async function getMemberConnectionContextWithError(
  memberId: string,
  provider: ChannelProvider
): Promise<{ ctx: ChannelConnectionContext | null; error: string | null }> {
  const conn = await prisma.channelConnection.findUnique({
    where: { memberId_provider: { memberId, provider } },
  });
  if (!conn || conn.status === "disconnected") {
    return { ctx: null, error: `Connect your ${provider} account in Sync Stores.` };
  }
  const ctx = await getConnectionContext(conn);
  if (ctx) return { ctx, error: null };
  const latest = await prisma.channelConnection.findUnique({
    where: { id: conn.id },
    select: { lastError: true, status: true },
  });
  const label = provider.charAt(0).toUpperCase() + provider.slice(1);
  return {
    ctx: null,
    error:
      latest?.lastError ??
      (latest?.status === "error"
        ? `${label} connection needs reconnecting. Open Sync Stores and reconnect.`
        : `${label} connection is unavailable. Reconnect in Sync Stores.`),
  };
}

/** eBay row exists and is not disconnected (taxonomy uses app tokens, not user OAuth). */
export async function memberHasEbayConnection(
  memberId: string
): Promise<{ connected: boolean; status: string | null }> {
  const conn = await prisma.channelConnection.findUnique({
    where: { memberId_provider: { memberId, provider: "ebay" } },
    select: { status: true },
  });
  if (!conn || conn.status === "disconnected") {
    return { connected: false, status: conn?.status ?? null };
  }
  return { connected: true, status: conn.status };
}

/** Every connection a member has that is eligible for syncing (not disconnected). */
export async function getActiveConnectionsForMember(
  memberId: string
): Promise<ChannelConnectionContext[]> {
  const conns = await prisma.channelConnection.findMany({
    where: { memberId, status: { not: "disconnected" } },
  });
  const out: ChannelConnectionContext[] = [];
  for (const c of conns) {
    const ctx = await getConnectionContext(c);
    if (ctx) out.push(ctx);
  }
  return out;
}

/**
 * Force a token refresh for a connection. Used by retry queue when an auth error occurs.
 * Returns true if successful, throws if refresh fails.
 */
export async function refreshConnectionToken(
  connectionId: string,
  provider: ChannelProvider
): Promise<void> {
  const conn = await prisma.channelConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn || !conn.refreshTokenEncrypted) {
    throw new Error("Connection not found or no refresh token available");
  }

  const refreshToken = decrypt(conn.refreshTokenEncrypted);
  const adapter = getAdapter(provider);
  const tokens = await adapter.refreshAccessToken(refreshToken);

  await prisma.channelConnection.update({
    where: { id: connectionId },
    data: {
      accessTokenEncrypted: encrypt(tokens.accessToken),
      ...(tokens.refreshToken
        ? { refreshTokenEncrypted: encrypt(tokens.refreshToken) }
        : {}),
      tokenExpiresAt: tokens.expiresInSec
        ? new Date(Date.now() + tokens.expiresInSec * 1000)
        : null,
      status: "active",
      lastError: null,
    },
  });
  logSyncEvent(conn.memberId, provider, "token_refreshed", "Refreshed after auth error in retry queue");
}

/** True when the channel returned an auth error that may succeed after refresh_token. */
export function isChannelAuthError(provider: ChannelProvider, e: unknown): boolean {
  if (e instanceof EbayApiError) {
    return e.status === 401 || needsTokenRefresh(e.body);
  }
  if (e instanceof EtsyApiError) {
    return e.status === 401;
  }
  if (provider === "ebay") {
    const msg = e instanceof Error ? e.message : String(e);
    return /IAF token|token supplied is expired|invalid access token/i.test(msg);
  }
  return false;
}

/**
 * Run an API call with the connection's access token; on auth failure, refresh once and retry.
 */
export async function withConnectionAuthRetry<T>(
  connection: ConnectionRow,
  fn: (ctx: ChannelConnectionContext) => Promise<T>
): Promise<T> {
  const provider = connection.provider as ChannelProvider;
  let ctx = await getConnectionContext(connection);
  if (!ctx) throw new Error("Channel connection unavailable or needs reconnecting.");

  try {
    return await fn(ctx);
  } catch (e) {
    if (!connection.refreshTokenEncrypted || !isChannelAuthError(provider, e)) {
      throw e;
    }
    await refreshConnectionToken(connection.id, provider);
    const fresh = await prisma.channelConnection.findUnique({ where: { id: connection.id } });
    if (!fresh) throw e;
    ctx = await getConnectionContext(fresh);
    if (!ctx) throw e;
    return fn(ctx);
  }
}
