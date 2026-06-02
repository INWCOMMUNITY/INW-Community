import { prisma } from "database";
import { encrypt, decrypt } from "@/lib/encrypt";
import { getAdapter } from "./registry";
import type { ChannelConnectionContext, ChannelProvider } from "./types";

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
    } catch (e) {
      await prisma.channelConnection
        .update({
          where: { id: connection.id },
          data: { status: "error", lastError: String(e).slice(0, 500) },
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
