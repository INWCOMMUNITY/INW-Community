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

/** Collect `warnings` from a successful eBay REST envelope (HTTP 200 can still rewrite fields). */
export function extractEbayWarnings(body: unknown): EbayErrorRow[] {
  if (!body || typeof body !== "object") return [];
  const warnings = (body as { warnings?: EbayErrorRow[] }).warnings;
  return Array.isArray(warnings) ? warnings : [];
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

/** Structured eBay error payload for logs (full codes, messages, parameters). */
export function formatEbayErrorDiagnostics(e: unknown): Record<string, unknown> {
  if (e instanceof EbayApiError) {
    const rows = parseEbayErrorRows(e.body);
    return {
      status: e.status,
      path: e.path,
      summary: formatEbayApiBody(e.body, e.status, e.path),
      errors: rows.map((row) => ({
        errorId: row.errorId,
        domain: row.domain,
        subdomain: row.subdomain,
        category: row.category,
        message: row.message,
        longMessage: row.longMessage,
        parameters: row.parameters,
      })),
      rawBody: e.body,
    };
  }
  if (e instanceof Error) {
    return { message: e.message, name: e.name };
  }
  return { message: String(e) };
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

/** True when eBay Inventory rejected item specifics / wire grade aspects (#25064 and kin). */
export function isEbayInventoryAspectValidationError(e: unknown): boolean {
  const msg = describeEbayThrownError(e);
  return /#25064|#25002|letter grade|numerical grade|professional grader|item specific|item specifics|required field/i.test(
    msg
  );
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
  25014: {
    message: "Invalid listing pictures",
    action: "seller_action",
    retryable: true,
  },
  25015: {
    message: "Invalid listing picture URL",
    action: "seller_action",
    retryable: true,
  },
  25021: {
    message: "Invalid condition for category",
    action: "seller_action",
    retryable: false,
  },
  25064: {
    message: "Missing required item specifics",
    action: "seller_action",
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
    return "eBay access token expired. Sync will retry after refreshing; if this persists, disconnect and reconnect eBay in Sync Stores.";
  }
  if (/\b1100\b|Insufficient permissions/i.test(reason)) {
    return "Your eBay connection lacks required permissions. Disconnect and reconnect eBay to grant all needed scopes.";
  }
  if (/mixture of self hosted and eps|self hosted and eps pictures/i.test(reason)) {
    return "eBay already has these photos as eBay-hosted images and does not allow mixing those with INW photo URLs. Other fields can still update; you do not need to re-upload the same pictures.";
  }
  if (/500 pixels|longest side|Picture Policy|resolution for provided picture/i.test(reason)) {
    return "eBay requires each photo to be at least 500 pixels on the longest side. Gallery thumbs cannot be used. If the listing already has full-size eBay photos, sync will send those; if a file itself is smaller than 500px, replace it and try again.";
  }
  if (/\b25014\b|\b25015\b|invalid pictures|invalid picture url/i.test(reason)) {
    return "eBay rejected the listing photos. This is usually mixed eBay-hosted and INW-hosted URLs, not a missing JPG. If you did not change photos, try again. If you did, use HTTPS JPG or PNG.";
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
  if (/\b25021\b|condition.*invalid|invalid.*condition/i.test(reason)) {
    return "This listing needs a condition that matches its eBay category. Open the listing in INW and choose New or Used when prompted.";
  }
  if (/\b25064\b|professional grader|numerical grade|item specific|item specifics/i.test(reason)) {
    return "eBay Inventory rejected the payload. Check the sent aspect keys in this error; edit title or photos in INW only when those actually changed.";
  }
  if (/\b25001\b|system error has occurred|Internal error/i.test(reason)) {
    return "eBay's service hit a temporary error. Wait a minute and try again.";
  }
  if (/not_fixed_price|not a fixed|auction|classified/i.test(reason)) {
    return "eBay only syncs fixed-price (Buy It Now) listings. Convert auctions/classified ads to fixed price to sync them.";
  }
  if (/variationInformation/i.test(reason)) {
    return "INW generates a unique SKU for each variation when it pushes to eBay. Retry sync so those SKUs are sent as a variation group.";
  }
  if (/multi-variation|variation/i.test(reason)) {
    return "INW generates a unique SKU for each variation when it pushes to eBay. Retry sync if this listing still needs a variation group update.";
  }
  if (/Could not set Custom Label/i.test(reason)) {
    return "INW could not write a Custom Label on this eBay listing. Open it in Seller Hub, set an alphanumeric Custom Label (max 50 characters), and import again.";
  }
  if (/SKU cannot be null|listing SKU cannot/i.test(reason)) {
    return "This eBay listing has no Custom Label (SKU). INW adds a valid SKU and retries migrate; if this persists, set an alphanumeric Custom Label (max 50 characters) in Seller Hub.";
  }
  if (/#25707|invalid value for a SKU/i.test(reason)) {
    return "eBay Inventory SKUs must be alphanumeric and at most 50 characters. Hyphens, spaces, and longer Custom Labels cannot be used.";
  }
  if (/timed out after \d+s/i.test(reason)) {
    return "eBay took too long to migrate this listing. Try importing it again — if migrate finished on eBay's side, the next attempt will pick up the existing SKU.";
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
  if (provider === "ebay") {
    const msg = describeEbayThrownError(e);
    if (/inventory verify|bulk_update_price_quantity|availableQuantity/i.test(msg)) {
      const hint = ebayErrorActionHint(msg);
      const base = `Quantity didn't update on eBay: ${msg}`;
      return hint ? `${base} — ${hint}` : base;
    }
    if (/passthrough partial sync|:\s*updated|:\s*failed/i.test(msg)) {
      const hint = ebayErrorActionHint(msg);
      return hint && !msg.includes(hint) ? `${msg} — ${hint}` : msg;
    }
    if (/#25064|#25002|item specific|required field.*aspect|aspect.*required|Letter grade/i.test(msg)) {
      const hint = ebayErrorActionHint(msg);
      const base = `Listing details didn't update on eBay: ${msg}`;
      return hint ? `${base} — ${hint}` : base;
    }
    if (/policy|fulfillment|merchant location|401|403|unauthorized/i.test(msg)) {
      const hint = ebayErrorActionHint(msg);
      const base = msg;
      return hint ? `${base} — ${hint}` : base;
    }
    const hint = ebayErrorActionHint(msg);
    return hint ? `${msg} — ${hint}` : msg;
  }
  const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
  if (provider === "etsy") {
    if (/invalid_marketplace|cannot sell this item on Etsy/i.test(msg)) {
      return `${msg} — Etsy will not list this item under the current category. Open Sync Stores → Needs Attention to pick a different Etsy category, or skip Etsy for this listing.`;
    }
  }
  if (provider === "wix") {
    if (/No Metasite Context|MetaSite not found/i.test(msg)) {
      return `${msg} — Disconnect and reconnect Wix in Sync Stores to refresh the site token.`;
    }
    if (/\b403\b/.test(msg)) {
      return `${msg} — Confirm Wix app has Stores read/write permissions in dev.wix.com, then reconnect Wix.`;
    }
  }
  return msg;
}
