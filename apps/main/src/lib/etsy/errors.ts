import { redactEtsySecrets } from "./redact";

export type EtsyErrorClass =
  | "AUTH"
  | "THROTTLED"
  | "TRANSIENT"
  | "PERMANENT"
  | "NETWORK"
  | "NOT_CONFIGURED"
  | "CONNECTION_INACTIVE";

export class EtsyRequestError extends Error {
  constructor(
    message: string,
    readonly errorClass: EtsyErrorClass,
    readonly httpStatus: number | null = null,
    readonly retryAfterMs: number | null = null
  ) {
    super(redactEtsySecrets(message));
    this.name = "EtsyRequestError";
  }
}

/** 429 is temporary/rate-limited, never a permanent listing failure. */
export function classifyEtsyHttpStatus(status: number): EtsyErrorClass {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 429) return "THROTTLED";
  if (status >= 500) return "TRANSIENT";
  if (status >= 400) return "PERMANENT";
  return "TRANSIENT";
}

export function isEtsyRetryableErrorClass(errorClass: EtsyErrorClass): boolean {
  return errorClass === "THROTTLED" || errorClass === "TRANSIENT" || errorClass === "NETWORK";
}

export function parseEtsyRetryAfterMs(headers: Headers, fallbackMs: number): number {
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) return fallbackMs;
  const asSeconds = Number(retryAfter);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(Math.max(asSeconds * 1000, 100), 60_000);
  }
  const asDate = Date.parse(retryAfter);
  if (Number.isFinite(asDate)) {
    return Math.min(Math.max(asDate - Date.now(), 100), 60_000);
  }
  return fallbackMs;
}
