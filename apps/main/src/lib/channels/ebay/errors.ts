/** Parse and format eBay REST/Inventory API errors for logs, UI, and syncStatus fields. */

export type EbayErrorRow = {
  errorId?: number;
  domain?: string;
  subdomain?: string;
  category?: string;
  message?: string;
  longMessage?: string;
  parameters?: { name?: string; value?: string }[];
};

type MigrateResponseBody = {
  responses?: {
    listingId?: string;
    statusCode?: number;
    errors?: EbayErrorRow[];
  }[];
};

export class EbayApiError extends Error {
  status: number;
  body: unknown;
  path?: string;

  constructor(message: string, status: number, body: unknown, path?: string) {
    super(message);
    this.name = "EbayApiError";
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

/** Collect errors from both top-level `errors` and bulk `responses[].errors` envelopes. */
export function parseEbayErrorRows(body: unknown): EbayErrorRow[] {
  if (!body || typeof body !== "object") return [];
  const envelope = body as { errors?: EbayErrorRow[] } & MigrateResponseBody;
  const rows: EbayErrorRow[] = [];
  if (Array.isArray(envelope.errors)) rows.push(...envelope.errors);
  for (const response of envelope.responses ?? []) {
    if (Array.isArray(response.errors)) rows.push(...response.errors);
  }
  return rows;
}

/** Bulk migrate responses may arrive on HTTP 400 with a `responses` array instead of top-level errors. */
export function extractBulkMigrateResponse(body: unknown): MigrateResponseBody | null {
  if (!body || typeof body !== "object") return null;
  const envelope = body as MigrateResponseBody;
  return Array.isArray(envelope.responses) && envelope.responses.length > 0 ? envelope : null;
}

/** One human-readable line per eBay error row, including id + HTTP status when available. */
export function formatEbayErrorRow(row: EbayErrorRow, httpStatus?: number): string {
  const text = (row.longMessage || row.message || "Unknown eBay error").trim();
  const tags: string[] = [];
  if (row.errorId != null) tags.push(`#${row.errorId}`);
  if (row.domain) tags.push(row.domain);
  if (row.category) tags.push(row.category);
  if (httpStatus != null && httpStatus >= 400) tags.push(`HTTP ${httpStatus}`);
  const prefix = tags.length > 0 ? `[${tags.join(" · ")}] ` : "";
  return `${prefix}${text}`.slice(0, 500);
}

function summarizeRawBody(body: unknown): string | null {
  if (body == null) return null;
  if (typeof body === "string") {
    const trimmed = body.trim();
    return trimmed ? trimmed.slice(0, 300) : null;
  }
  try {
    const json = JSON.stringify(body);
    if (json && json !== "{}" && json !== "[]") return json.slice(0, 300);
  } catch {
    /* ignore */
  }
  return null;
}

/** Full message from an eBay error response body. */
export function formatEbayApiBody(body: unknown, httpStatus: number, path?: string): string {
  // Per-listing bulk-migrate failures first, so the message names the offending listing id.
  const migrate = extractBulkMigrateResponse(body);
  if (migrate?.responses?.length) {
    const lines = migrate.responses.map((r) => {
      const err = r.errors?.[0];
      const listing = r.listingId ? `listing ${r.listingId}` : "listing";
      const code = r.statusCode != null ? `HTTP ${r.statusCode}` : `HTTP ${httpStatus}`;
      if (err) return `${listing}: ${formatEbayErrorRow(err, r.statusCode ?? httpStatus)}`;
      return `${listing}: ${code} — no error details for this item`;
    });
    return lines.join(" | ").slice(0, 500);
  }

  const rows = parseEbayErrorRows(body);
  if (rows.length > 0) {
    return rows.map((row) => formatEbayErrorRow(row, httpStatus)).join(" | ").slice(0, 500);
  }

  const raw = summarizeRawBody(body);
  if (raw) {
    const prefix = path ? `${path} ` : "";
    return `${prefix}[HTTP ${httpStatus}] ${raw}`.slice(0, 500);
  }

  const endpoint = path ? ` on ${path}` : "";
  if (httpStatus === 400) {
    return `eBay HTTP 400${endpoint} — bad request (empty response). The listing may already be migrated, be the wrong type (auction/variation), or need a SKU in Seller Hub. Try disconnect/reconnect eBay if this persists.`;
  }
  return `eBay HTTP ${httpStatus}${endpoint} — eBay returned no error details in the response body`;
}

export function formatEbayApiErrorMessage(body: unknown, httpStatus: number, path?: string): string {
  return formatEbayApiBody(body, httpStatus, path);
}

/** Best-effort detail for a thrown value (EbayApiError, Error, or unknown). */
export function describeEbayThrownError(e: unknown): string {
  if (e instanceof EbayApiError) {
    const fromBody = formatEbayApiBody(e.body, e.status, e.path);
    if (!fromBody.includes("no error details")) return fromBody;
    if (e.message && !e.message.startsWith("eBay API error (")) return e.message.slice(0, 500);
    return fromBody;
  }
  if (e instanceof Error) return e.message.slice(0, 500);
  return String(e).slice(0, 500);
}

export function formatMigrateListingError(args: {
  statusCode?: number;
  errors?: EbayErrorRow[];
}): string {
  const row = args.errors?.[0];
  if (row) return formatEbayErrorRow(row, args.statusCode);
  if (args.statusCode != null && args.statusCode >= 300) {
    return `[HTTP ${args.statusCode}] migration_failed — eBay rejected this listing migration`;
  }
  return "migration_failed — eBay returned no details for this listing";
}

/**
 * eBay error codes with specific meanings and recommended actions.
 * See: https://developer.ebay.com/api-docs/sell/inventory/handling-errors.html
 */
export type EbayErrorAction = {
  message: string;
  action: "refresh_token" | "reauthorize" | "retry" | "seller_action" | "none";
  retryable: boolean;
};

const ERROR_CODE_ACTIONS: Record<number, EbayErrorAction> = {
  // OAuth / Token errors
  1001: {
    message: "Invalid access token",
    action: "refresh_token",
    retryable: true,
  },
  1002: {
    message: "Missing access token",
    action: "reauthorize",
    retryable: false,
  },
  1003: {
    message: "Invalid token type",
    action: "reauthorize",
    retryable: false,
  },
  1004: {
    message: "Error processing access token",
    action: "retry",
    retryable: true,
  },
  1100: {
    message: "Insufficient permissions - the token lacks required scopes",
    action: "reauthorize",
    retryable: false,
  },

  // Inventory API errors
  25001: {
    message: "eBay system error",
    action: "retry",
    retryable: true,
  },
  25002: {
    message: "User error in request",
    action: "none",
    retryable: false,
  },
  25003: {
    message: "Invalid price",
    action: "seller_action",
    retryable: false,
  },
  25004: {
    message: "Invalid quantity",
    action: "seller_action",
    retryable: false,
  },
  25005: {
    message: "Invalid category ID",
    action: "seller_action",
    retryable: false,
  },
  25017: {
    message: "Missing required fields for listing",
    action: "seller_action",
    retryable: false,
  },
  25018: {
    message: "Incomplete seller account setup",
    action: "seller_action",
    retryable: false,
  },
  25019: {
    message: "Cannot revise listing (may have active bids or ending soon)",
    action: "none",
    retryable: false,
  },
  25025: {
    message: "Concurrent access conflict",
    action: "retry",
    retryable: true,
  },
  25026: {
    message: "eBay selling limit exceeded",
    action: "seller_action",
    retryable: false,
  },
};

/**
 * Get specific error info for a known eBay error code.
 */
export function getEbayErrorInfo(errorId: number | undefined): EbayErrorAction | null {
  if (errorId === undefined) return null;
  return ERROR_CODE_ACTIONS[errorId] ?? null;
}

/**
 * Extract error IDs from an error body for targeted handling.
 */
export function extractErrorIds(body: unknown): number[] {
  const rows = parseEbayErrorRows(body);
  return rows.map((r) => r.errorId).filter((id): id is number => id !== undefined);
}

/**
 * Check if an error is retryable based on its error codes.
 */
export function isRetryableError(body: unknown): boolean {
  const errorIds = extractErrorIds(body);
  if (errorIds.length === 0) return false;
  return errorIds.every((id) => {
    const info = getEbayErrorInfo(id);
    return info?.retryable ?? false;
  });
}

/**
 * Check if an error requires token refresh.
 */
export function needsTokenRefresh(body: unknown): boolean {
  const errorIds = extractErrorIds(body);
  return errorIds.some((id) => {
    const info = getEbayErrorInfo(id);
    return info?.action === "refresh_token";
  });
}

/**
 * Check if an error requires full reauthorization.
 */
export function needsReauthorization(body: unknown): boolean {
  const errorIds = extractErrorIds(body);
  return errorIds.some((id) => {
    const info = getEbayErrorInfo(id);
    return info?.action === "reauthorize";
  });
}

/** Actionable hint for common eBay error patterns (import UI, sync stores). */
export function ebayErrorActionHint(reason: string): string | undefined {
  // Check for specific error codes first
  if (/\b1001\b|Invalid access token/i.test(reason)) {
    return "eBay session expired — disconnect and reconnect eBay in Sync Stores.";
  }
  if (/\b1100\b|Insufficient permissions/i.test(reason)) {
    return "Your eBay connection lacks required permissions. Disconnect and reconnect eBay to grant all needed scopes.";
  }
  if (/\b25017\b|Missing.*field|required field/i.test(reason)) {
    return "This listing is missing required information. Check that title, description, price, category, and item specifics are filled in.";
  }
  if (/\b25018\b|Incomplete.*account/i.test(reason)) {
    return "Your eBay seller account setup is incomplete. Visit eBay Seller Hub to finish account setup.";
  }
  if (/\b25019\b|Cannot revise|active bid|ending soon/i.test(reason)) {
    return "This listing cannot be revised right now. It may have active bids or be ending within 12 hours.";
  }
  if (/\b25025\b|Concurrent access/i.test(reason)) {
    return "eBay detected a conflict. Wait a moment and try again.";
  }
  if (/\b25026\b|selling limit/i.test(reason)) {
    return "You've reached your eBay selling limit. Contact eBay to request a limit increase.";
  }
  if (/\b25001\b|system error has occurred|Internal error/i.test(reason)) {
    return "eBay's service hit a temporary error. Wait a minute and try again.";
  }
  if (/not_fixed_price|not a fixed|auction|classified/i.test(reason)) {
    return "eBay only syncs fixed-price (Buy It Now) listings. Convert auctions/classified ads to fixed price to sync them.";
  }
  if (/multi-variation|variation/i.test(reason)) {
    return "Multi-variation listings need a unique SKU per variation in Seller Hub before they can sync.";
  }
  if (/25718|Cannot migrate listing|bad request|HTTP 400/i.test(reason)) {
    return "eBay couldn't migrate this listing. Make sure it's a fixed-price GTC listing with payment/return/shipping policies and a merchant location set in Seller Hub.";
  }
  if (/Accept-Language/i.test(reason)) {
    return "eBay rejected the locale header. Make sure the latest app version is deployed.";
  }
  if (/25709|Content-Language/i.test(reason)) {
    return "eBay rejected a content locale header during listing sync.";
  }
  if (/business polic|fulfillmentPolicy|paymentPolicy|returnPolicy|merchant location/i.test(reason)) {
    return "Add payment, return, and shipping policies plus a merchant location in eBay Seller Hub.";
  }
  if (/revision limit|250.*revision/i.test(reason)) {
    return "This listing has reached eBay's daily revision limit (250 per day). Try again tomorrow.";
  }
  return undefined;
}

export function describeChannelSyncError(provider: string, e: unknown): string {
  if (provider === "ebay") return describeEbayThrownError(e);
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}
