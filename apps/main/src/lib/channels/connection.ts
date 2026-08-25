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
import { shouldBlockDevChannelTokenWrites } from "./dev-prod-guard";
import {
  classifyChannelPauseReason,
  connectionHealthUx,
  nextRecoverAt,
  shouldSkipPausedRecover,
  readPauseConfig,
} from "./pause-reason";

/** Refresh before the token's last 5 minutes so the channel cron never starts on a dying token. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const REFRESH_LOCK_TTL_MS = 20_000;
const refreshInflight = new Map<string, Promise<string>>();

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

export function mergeConnectionConfig(
  config: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const base =
    config && typeof config === "object" && !Array.isArray(config)
      ? { ...(config as Record<string, unknown>) }
      : {};
  return { ...base, ...patch };
}

function readRefreshingAt(config: unknown): number | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const raw = (config as Record<string, unknown>).refreshingAt;
  if (typeof raw !== "string") return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

function isRefreshLockHeld(config: unknown): boolean {
  const at = readRefreshingAt(config);
  return at != null && Date.now() - at < REFRESH_LOCK_TTL_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function persistRefreshLock(connection: ConnectionRow, held: boolean): Promise<void> {
  await prisma.channelConnection
    .update({
      where: { id: connection.id },
      data: {
        config: mergeConnectionConfig(connection.config, {
          refreshingAt: held ? new Date().toISOString() : null,
        }) as Prisma.InputJsonValue,
      },
    })
    .catch(() => {});
}

async function waitForPeerRefresh(connectionId: string): Promise<ConnectionRow | null> {
  for (let i = 0; i < 15; i += 1) {
    await sleep(250);
    const row = await prisma.channelConnection.findUnique({ where: { id: connectionId } });
    if (!row) return null;
    if (!isRefreshLockHeld(row.config)) return row as ConnectionRow;
  }
  return (await prisma.channelConnection.findUnique({ where: { id: connectionId } })) as ConnectionRow | null;
}

async function performTokenRefresh(connection: ConnectionRow): Promise<string> {
  if (shouldBlockDevChannelTokenWrites()) {
    throw new Error(
      "Skipped channel token refresh: local process is using a hosted production database. Set ALLOW_PROD_DB_FROM_DEV=1 to override."
    );
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest =
      ((await prisma.channelConnection.findUnique({ where: { id: connection.id } })) as ConnectionRow | null) ??
      connection;
    if (!latest.refreshTokenEncrypted) {
      throw new Error("Connection not found or no refresh token available");
    }
    try {
      const refreshToken = decrypt(latest.refreshTokenEncrypted);
      const adapter = getAdapter(latest.provider as ChannelProvider);
      const tokens = await adapter.refreshAccessToken(refreshToken);
      await prisma.channelConnection.update({
        where: { id: latest.id },
        data: {
          accessTokenEncrypted: encrypt(tokens.accessToken),
          ...(tokens.refreshToken ? { refreshTokenEncrypted: encrypt(tokens.refreshToken) } : {}),
          tokenExpiresAt: tokens.expiresInSec
            ? new Date(Date.now() + tokens.expiresInSec * 1000)
            : latest.tokenExpiresAt,
          ...(tokens.scopes ? { scopes: tokens.scopes } : {}),
          status: "active",
          lastError: null,
          config: mergeConnectionConfig(latest.config, { refreshingAt: null }) as Prisma.InputJsonValue,
        },
      });
      logSyncEvent(latest.memberId, latest.provider as ChannelProvider, "token_refreshed");
      return tokens.accessToken;
    } catch (e) {
      lastError = e;
      const reread = (await prisma.channelConnection.findUnique({
        where: { id: connection.id },
      })) as ConnectionRow | null;
      if (reread?.accessTokenEncrypted && reread.accessTokenEncrypted !== latest.accessTokenEncrypted) {
        try {
          return decrypt(reread.accessTokenEncrypted);
        } catch {
          /* continue */
        }
      }
      if (attempt < 2) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function refreshAccessTokenSerialized(connection: ConnectionRow): Promise<string> {
  const existing = refreshInflight.get(connection.id);
  if (existing) return existing;

  const run = (async () => {
    const latest =
      ((await prisma.channelConnection.findUnique({ where: { id: connection.id } })) as ConnectionRow | null) ??
      connection;
    if (isRefreshLockHeld(latest.config)) {
      const waited = await waitForPeerRefresh(connection.id);
      if (waited?.accessTokenEncrypted) {
        try {
          return decrypt(waited.accessTokenEncrypted);
        } catch {
          /* peer failed; try ourselves */
        }
      }
    }
    await persistRefreshLock(latest, true);
    try {
      return await performTokenRefresh(latest);
    } finally {
      const after = (await prisma.channelConnection.findUnique({
        where: { id: connection.id },
      })) as ConnectionRow | null;
      if (after) await persistRefreshLock(after, false);
    }
  })();

  refreshInflight.set(connection.id, run);
  try {
    return await run;
  } finally {
    if (refreshInflight.get(connection.id) === run) refreshInflight.delete(connection.id);
  }
}

/** Cron: retry OAuth refresh for paused stores so sellers don't have to reconnect after a race. */
export async function recoverPausedChannelConnections(): Promise<{ recovered: number; failed: number }> {
  if (shouldBlockDevChannelTokenWrites()) {
    console.error("[channels] skip recovering paused connections: local dev against hosted DB");
    return { recovered: 0, failed: 0 };
  }
  const paused = await prisma.channelConnection.findMany({
    where: { status: "error", refreshTokenEncrypted: { not: null } },
  });
  let recovered = 0;
  let failed = 0;
  for (const c of paused) {
    if (shouldSkipPausedRecover(c.config)) {
      continue;
    }
    const pause = readPauseConfig(c.config);
    try {
      await refreshAccessTokenSerialized(c as ConnectionRow);
      await prisma.channelConnection
        .update({
          where: { id: c.id },
          data: {
            config: mergeConnectionConfig(c.config, {
              pauseReason: null,
              recoverAttempts: 0,
              nextRecoverAt: null,
            }) as Prisma.InputJsonValue,
          },
        })
        .catch(() => {});
      recovered += 1;
    } catch (e) {
      failed += 1;
      const reason = classifyChannelPauseReason(e);
      const attempts = pause.recoverAttempts + 1;
      await prisma.channelConnection
        .update({
          where: { id: c.id },
          data: {
            config: mergeConnectionConfig(c.config, {
              pauseReason: reason,
              recoverAttempts: attempts,
              nextRecoverAt: nextRecoverAt(reason, attempts).toISOString(),
            }) as Prisma.InputJsonValue,
          },
        })
        .catch(() => {});
      console.warn("[channels] could not auto-recover paused connection", {
        connectionId: c.id,
        provider: c.provider,
        pauseReason: reason,
        recoverAttempts: attempts,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { recovered, failed };
}

/**
 * True when the seller must reconnect (refresh token dead). False for an expired
 * access token (#1001 / IAF) that the next cron can refresh.
 */
export function isPermanentChannelAuthFailure(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /invalid[_ -]?grant|invalid_refresh|refresh token.*(expired|revoked|invalid)|unauthorized_client|invalid_client|no refresh token|could not be decrypted|encryption key cannot decrypt|platform encryption|consent.*revoked/i.test(
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

  const pauseReason = classifyChannelPauseReason(error);
  const pause = readPauseConfig(connection.config);
  const attempts = pause.recoverAttempts + 1;
  logSyncEvent(
    connection.memberId,
    connection.provider,
    "pause_classified",
    `${pauseReason}: ${lastError.slice(0, 200)}`
  );

  let nextConfig = mergeConnectionConfig(connection.config, {
    pauseReason,
    recoverAttempts: attempts,
    nextRecoverAt: nextRecoverAt(pauseReason, attempts).toISOString(),
  });

  if (pauseReason !== "decrypt_failure") {
    const sent = await notifyChannelDisconnectIfNew({
      memberId: connection.memberId,
      provider: connection.provider,
      previousStatus: connection.status,
      lastNotifiedAt: readDisconnectNotifiedAt(connection.config),
    }).catch(() => false);
    if (sent) {
      nextConfig = mergeConnectionConfig(nextConfig, {
        disconnectNotifiedAt: new Date().toISOString(),
      });
    }
  }

  await prisma.channelConnection
    .update({
      where: { id: connection.id },
      data: {
        status: "error",
        lastError,
        config: nextConfig as Prisma.InputJsonValue,
      },
    })
    .catch(() => {});

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
      "Platform encryption key cannot decrypt this store's tokens. Do not reconnect — contact support.";
    logSyncEvent(connection.memberId, connection.provider, "token_expired", errMsg);
    if (shouldBlockDevChannelTokenWrites()) {
      console.error("[channels] decrypt failed; not pausing hosted connections from local dev", {
        connectionId: connection.id,
        provider: connection.provider,
      });
      return null;
    }
    await markChannelConnectionFailure({
      connection,
      error: new Error(errMsg),
      lastError: errMsg,
    });
    return null;
  }

  const expiresAt = connection.tokenExpiresAt?.getTime();
  const expired = expiresAt != null && expiresAt - REFRESH_SKEW_MS < Date.now();
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
    if (shouldBlockDevChannelTokenWrites()) {
      console.error("[channels] refusing token refresh from local dev against hosted DB", {
        connectionId: connection.id,
        provider: connection.provider,
      });
    } else {
      try {
        accessToken = await refreshAccessTokenSerialized(connection);
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
  const health = connectionHealthUx({
    status: latest?.status ?? conn.status,
    lastError: latest?.lastError,
    config: conn.config,
  });
  const fallback =
    health.kind === "ok"
      ? `${label} connection is unavailable. Reconnect in Sync Stores.`
      : health.message;
  return {
    ctx: null,
    error: latest?.lastError ?? fallback,
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
  _provider: ChannelProvider
): Promise<string> {
  const conn = await prisma.channelConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn || !conn.refreshTokenEncrypted) {
    throw new Error("Connection not found or no refresh token available");
  }
  return refreshAccessTokenSerialized(conn as ConnectionRow);
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
