import { prisma } from "database";
import { encrypt, decrypt } from "@/lib/encrypt";
import { getAdapter } from "./registry";
import type { ChannelConnectionContext, ChannelProvider } from "./types";
import { logSyncEvent } from "./sync-log";

const REFRESH_SKEW_MS = 60_000;

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
  } catch {
    return null;
  }

  const expiresAt = connection.tokenExpiresAt?.getTime();
  const expired = expiresAt != null && expiresAt - REFRESH_SKEW_MS < Date.now();
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
      import("@/lib/send-push-notification")
        .then(({ sendPushNotification }) => {
          const label =
            connection.provider.charAt(0).toUpperCase() + connection.provider.slice(1);
          sendPushNotification(connection.memberId, {
            title: `${label} connection needs attention`,
            body: "Your sync connection expired. Open Sync Stores to reconnect.",
            data: { screen: "seller-hub/channels" },
            category: "commerce",
          }).catch(() => {});
        })
        .catch(() => {});
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
  if (!conn) return null;
  return getConnectionContext(conn);
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
