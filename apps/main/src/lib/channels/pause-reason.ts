export type ChannelPauseReason =
  | "invalid_grant"
  | "decrypt_failure"
  | "no_refresh_token"
  | "unauthorized_client"
  | "unknown_permanent";

export type ChannelHealthKind = "ok" | "reconnect" | "delayed" | "platform_key";

const BACKOFF_MS = [15 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];

export function classifyChannelPauseReason(error: unknown): ChannelPauseReason {
  const msg = error instanceof Error ? error.message : String(error);
  if (/could not be decrypted|encryption key cannot decrypt|platform encryption/i.test(msg)) {
    return "decrypt_failure";
  }
  if (/unauthorized_client|invalid_client/i.test(msg)) return "unauthorized_client";
  if (/no refresh token/i.test(msg)) return "no_refresh_token";
  if (/reconnect your shopify store|shopify offline token/i.test(msg)) return "no_refresh_token";
  if (/invalid[_ -]?grant|invalid_refresh|refresh token.*(expired|revoked|invalid)|consent.*revoked/i.test(msg)) {
    return "invalid_grant";
  }
  return "unknown_permanent";
}

export function nextRecoverAt(reason: ChannelPauseReason, attempt: number, from = Date.now()): Date {
  if (reason === "decrypt_failure") {
    return new Date(from + 24 * 60 * 60 * 1000);
  }
  const idx = Math.min(Math.max(attempt, 0), BACKOFF_MS.length - 1);
  return new Date(from + BACKOFF_MS[idx]!);
}

export function readPauseConfig(config: unknown): {
  pauseReason: ChannelPauseReason | null;
  recoverAttempts: number;
  nextRecoverAt: Date | null;
} {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { pauseReason: null, recoverAttempts: 0, nextRecoverAt: null };
  }
  const c = config as Record<string, unknown>;
  const pauseReason =
    typeof c.pauseReason === "string" ? (c.pauseReason as ChannelPauseReason) : null;
  const recoverAttempts = typeof c.recoverAttempts === "number" ? c.recoverAttempts : 0;
  const nextRaw = typeof c.nextRecoverAt === "string" ? Date.parse(c.nextRecoverAt) : NaN;
  return {
    pauseReason,
    recoverAttempts,
    nextRecoverAt: Number.isNaN(nextRaw) ? null : new Date(nextRaw),
  };
}

export function shouldSkipPausedRecover(config: unknown, now = Date.now()): boolean {
  const { nextRecoverAt: at } = readPauseConfig(config);
  return Boolean(at && at.getTime() > now);
}

export function connectionHealthUx(args: {
  status: string;
  lastError?: string | null;
  config?: unknown;
}): { kind: ChannelHealthKind; message: string; pauseReason: ChannelPauseReason | null } {
  if (args.status !== "error") {
    return { kind: "ok", message: "", pauseReason: null };
  }
  const fromConfig = readPauseConfig(args.config).pauseReason;
  const reason = fromConfig ?? (args.lastError ? classifyChannelPauseReason(args.lastError) : "unknown_permanent");
  if (reason === "decrypt_failure") {
    return {
      kind: "platform_key",
      message:
        "This store cannot sync because of a platform encryption-key issue. Do not reconnect — contact support.",
      pauseReason: reason,
    };
  }
  if (reason === "invalid_grant" || reason === "no_refresh_token" || reason === "unauthorized_client") {
    return {
      kind: "reconnect",
      message: "Reconnect this store in Sync Stores. The marketplace refresh token is no longer valid.",
      pauseReason: reason,
    };
  }
  return {
    kind: "delayed",
    message: "Sync is delayed and retrying automatically. You do not need to reconnect yet.",
    pauseReason: reason,
  };
}

export const CHANNEL_SALES_FULFILL_NOTE =
  "Sales on Etsy, eBay, Wix, or Shopify are fulfilled on those marketplaces — not with INW Shippo labels.";
