import { prisma, Prisma } from "database";
import { encrypt, decrypt } from "@/lib/encrypt";
import { getAdapter } from "./registry";
import type { ChannelConnectionContext, ChannelProvider } from "./types";
import { logSyncEvent } from "./sync-log";
import { EbayApiError, needsTokenRefresh } from "./ebay/errors";
import { EtsyApiError } from "./etsy/client";
import {
  notifyChannelDisconnectIfNew,
  readDisconnectNotifiedAt,
} from "./channel-disconnect-notify";

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
  scopes?: string | null;
  config?: unknown;
};

function mergeConnectionConfig(
  config: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const base =
    config && typeof config === "object" && !Array.isArray(config)
      ? { ...(config as Record<string, unknown>) }
      : {};
  return { ...base, ...patch };
}

/**
 * True when the seller must reconnect (refresh token dead). False for an expired
 * access token (#1001 / IAF) that the next cron can refresh.
 */
export function isPermanentChannelAuthFailure(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /invalid[_ -]?grant|invalid_refresh|refresh token.*(expired|revoked|invalid)|unauthorized_client|invalid_client|no refresh token|could not be decrypted|consent.*revoked/i.test(
    msg
  );
}

export function connectionNeedsReconnect(
  error: unknown,
  hasRefreshToken: boolean
): boolean {
  if (!hasRefreshToken) return true;
  return isPermanentChannelAuthFailure(error);
}

/** Pause + notify only when the seller actually has to reconnect. */
export async function markChannelConnectionFailure(args: {
  connection: ConnectionRow;
  error: unknown;
  lastError: string;
}): Promise<{ paused: boolean }> {
  const { connection, error, lastError } = args;
  if (!connectionNeedsReconnect(error, Boolean(connection.refreshTokenEncrypted))) {
    console.warn("[channels] transient channel error; not pausing connection", {
      connectionId: connection.id,
      provider: connection.provider,
      error: lastError.slice(0, 240),
    });
    return { paused: false };
  }

  await prisma.channelConnection
    .update({
      where: { id: connection.id },
      data: { status: "error", lastError },
    })
    .catch(() => {});

  const sent = await notifyChannelDisconnectIfNew({
    memberId: connection.memberId,
    provider: connection.provider,
    previousStatus: connection.status,
    lastNotifiedAt: readDisconnectNotifiedAt(connection.config),
  }).catch(() => false);

  if (sent) {
    await prisma.channelConnection
      .update({
        where: { id: connection.id },
        data: {
          config: mergeConnectionConfig(connection.config, {
            disconnectNotifiedAt: new Date().toISOString(),
          }) as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});
  }

  return { paused: true };
}

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
    logSyncEvent(connection.memberId, connection.provider, "token_expired", errMsg);
    await markChannelConnectionFailure({
      connection,
      error: new Error(errMsg),
      lastError: errMsg,
    });
    return null;
  }

  const expiresAt = connection.tokenExpiresAt?.getTime();
  const expired =
    expiresAt == null
      ? Boolean(connection.refreshTokenEncrypted)
      : expiresAt - REFRESH_SKEW_MS < Date.now();
  if (expired && !connection.refreshTokenEncrypted) {
    const errMsg = "Channel access token expired with no refresh token. Reconnect in Sync Stores.";
    logSyncEvent(connection.memberId, connection.provider, "token_expired", errMsg);
    await markChannelConnectionFailure({
      connection,
      error: new Error(errMsg),
      lastError: errMsg,
    });
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
          ...(tokens.scopes ? { scopes: tokens.scopes } : {}),
          status: "active",
          lastError: null,
        },
      });
      logSyncEvent(connection.memberId, connection.provider, "token_refreshed");
    } catch (e) {
      const errMsg = String(e).slice(0, 500);
      logSyncEvent(
        connection.memberId,
        connection.provider,
        "token_expired",
        `Token refresh failed: ${errMsg}`
      );
      await markChannelConnectionFailure({
        connection,
        error: e,
        lastError: `Token refresh failed: ${errMsg}`,
      });
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
    scopes: connection.scopes ?? null,
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
 * Returns the new access token. Throws if refresh fails.
 */
export async function refreshConnectionToken(
  connectionId: string,
  provider: ChannelProvider
): Promise<string> {
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
  return tokens.accessToken;
}

/** True when the channel returned an auth error that may succeed after refresh_token. */
export function isChannelAuthError(provider: ChannelProvider, e: unknown): boolean {
  if (e instanceof EbayApiError) {
    return (
      e.status === 401 ||
      needsTokenRefresh(e.body) ||
      /IAF token|token supplied is expired|invalid access token|#1001/i.test(e.message)
    );
  }
  if (e instanceof EtsyApiError) {
    return e.status === 401;
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (provider === "ebay") {
    return /IAF token|token supplied is expired|invalid access token|#1001/i.test(msg);
  }
  return false;
}

/**
 * Run an API call with the connection's access token; on auth failure, refresh once and retry.
 * Always reloads the row from the DB first so a prior refresh in this cron is not overwritten
 * by a stale in-memory accessTokenEncrypted.
 */
export async function withConnectionAuthRetry<T>(
  connection: ConnectionRow,
  fn: (ctx: ChannelConnectionContext) => Promise<T>
): Promise<T> {
  const provider = connection.provider as ChannelProvider;
  const latest =
    (await prisma.channelConnection.findUnique({ where: { id: connection.id } })) ?? connection;
  let ctx = await getConnectionContext(latest);
  if (!ctx) throw new Error("Channel connection unavailable or needs reconnecting.");

  try {
    return await fn(ctx);
  } catch (e) {
    if (!latest.refreshTokenEncrypted || !isChannelAuthError(provider, e)) {
      throw e;
    }
    console.warn("[channels] auth error; refreshing access token and retrying", {
      connectionId: connection.id,
      provider,
      error: e instanceof Error ? e.message : String(e),
    });
    const accessToken = await refreshConnectionToken(connection.id, provider);
    return fn({ ...ctx, accessToken });
  }
}
