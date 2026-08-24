/**
 * Error classifier for channel sync operations.
 * Classifies errors as transient (retry-worthy), permanent (don't retry),
 * or auth (needs token refresh then retry once).
 */

export type ErrorClassification = "transient" | "permanent" | "auth";

/**
 * Patterns indicating transient errors that should be retried.
 */
const TRANSIENT_PATTERNS = [
  /\b429\b/i,
  /rate.?limit/i,
  /too many requests/i,
  /\b5\d{2}\b/,
  /internal server error/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /timeout/i,
  /timed out/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /network error/i,
  /concurrent access/i,
  /concurrent modification/i,
  /try again/i,
  /temporarily unavailable/i,
  /service is busy/i,
  /overloaded/i,
];

/**
 * Patterns indicating permanent errors that should not be retried.
 */
const PERMANENT_PATTERNS = [
  /\b400\b.*invalid/i,
  /invalid request/i,
  /validation failed/i,
  /invalid parameter/i,
  /\b404\b/,
  /not found/i,
  /does not exist/i,
  /\b403\b/,
  /forbidden/i,
  /access denied/i,
  /permission denied/i,
  /account suspended/i,
  /account disabled/i,
  /shop is closed/i,
  /shop is inactive/i,
  /listing ended/i,
  /ended item/i,
  /revise an ended/i,
  /#25604\b/,
  /availability not found/i,
  /listing removed/i,
  /invalid sku/i,
  /sku not found/i,
  /invalid listing/i,
  /malformed/i,
  /missing required/i,
  /duplicate/i,
  /already exists/i,
  /cannot be modified/i,
  /immutable/i,
  /policy violation/i,
  /blocked/i,
  /banned/i,
  /revision limit/i,
  /daily limit/i,
  /quota exceeded/i,
];

/**
 * Patterns indicating authentication errors that may be fixed by token refresh.
 */
const AUTH_PATTERNS = [
  /\b401\b/,
  /unauthorized/i,
  /authentication required/i,
  /invalid.?token/i,
  /token.?expired/i,
  /access.?token.?invalid/i,
  /refresh.?token/i,
  /session expired/i,
  /login required/i,
  /credentials/i,
  /invalid oauth/i,
  /oauth error/i,
];

/**
 * HTTP status codes and their classifications.
 */
const STATUS_CLASSIFICATIONS: Record<number, ErrorClassification> = {
  400: "permanent",
  401: "auth",
  403: "permanent",
  404: "permanent",
  405: "permanent",
  409: "transient",
  410: "permanent",
  422: "permanent",
  429: "transient",
  500: "transient",
  502: "transient",
  503: "transient",
  504: "transient",
};

/**
 * Extract HTTP status code from an error if available.
 */
function extractStatusCode(error: unknown): number | null {
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    if (typeof e.status === "number") return e.status;
    if (typeof e.statusCode === "number") return e.statusCode;
    if (typeof e.code === "number" && e.code >= 100 && e.code < 600) return e.code;
    if (e.response && typeof e.response === "object") {
      const res = e.response as Record<string, unknown>;
      if (typeof res.status === "number") return res.status;
      if (typeof res.statusCode === "number") return res.statusCode;
    }
  }
  return null;
}

/**
 * Convert an error to a string for pattern matching.
 */
function errorToString(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) {
    const errObj = error as unknown as Record<string, unknown>;
    const parts = [error.message];
    if (error.name) parts.unshift(error.name);
    if (errObj.code) {
      parts.push(String(errObj.code));
    }
    return parts.join(" ");
  }
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    const parts: string[] = [];
    if (e.message) parts.push(String(e.message));
    if (e.error) parts.push(String(e.error));
    if (e.code) parts.push(String(e.code));
    if (e.reason) parts.push(String(e.reason));
    return parts.join(" ");
  }
  return String(error);
}

/**
 * Classify an error as transient, permanent, or auth.
 *
 * Classification priority:
 * 1. Check HTTP status code if available
 * 2. Check for auth-related patterns (most specific)
 * 3. Check for permanent error patterns
 * 4. Check for transient error patterns
 * 5. Default to transient (safer to retry than to drop)
 */
export function classifyError(error: unknown): ErrorClassification {
  const statusCode = extractStatusCode(error);
  if (statusCode !== null && STATUS_CLASSIFICATIONS[statusCode]) {
    return STATUS_CLASSIFICATIONS[statusCode];
  }

  const errorStr = errorToString(error);

  for (const pattern of AUTH_PATTERNS) {
    if (pattern.test(errorStr)) {
      return "auth";
    }
  }

  for (const pattern of PERMANENT_PATTERNS) {
    if (pattern.test(errorStr)) {
      return "permanent";
    }
  }

  for (const pattern of TRANSIENT_PATTERNS) {
    if (pattern.test(errorStr)) {
      return "transient";
    }
  }

  return "transient";
}

/**
 * Check if an error is classified as transient.
 */
export function isTransientError(error: unknown): boolean {
  return classifyError(error) === "transient";
}

/**
 * Check if an error is classified as permanent.
 */
export function isPermanentError(error: unknown): boolean {
  return classifyError(error) === "permanent";
}

export function isEbayEndedListingError(error: unknown): boolean {
  return /ended item|listing ended|revise an ended|#25604\b|availability not found/i.test(
    errorToString(error)
  );
}

/**
 * Check if an error is classified as an auth error.
 */
export function isAuthError(error: unknown): boolean {
  return classifyError(error) === "auth";
}

/**
 * Get a human-readable description of the error classification.
 */
export function describeClassification(classification: ErrorClassification): string {
  switch (classification) {
    case "transient":
      return "Temporary error - will retry automatically";
    case "permanent":
      return "Permanent error - manual intervention required";
    case "auth":
      return "Authentication error - token refresh attempted";
  }
}
