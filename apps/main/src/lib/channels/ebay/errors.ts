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
  const rows = parseEbayErrorRows(body);
  if (rows.length > 0) {
    return rows.map((row) => formatEbayErrorRow(row, httpStatus)).join(" | ").slice(0, 500);
  }

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

/** Actionable hint for common eBay error patterns (import UI, sync stores). */
export function ebayErrorActionHint(reason: string): string | undefined {
  if (/25001|system error has occurred|Internal error/i.test(reason)) {
    return "eBay's migration service hit a temporary server error. Wait a minute and try again.";
  }
  if (/25718|Cannot migrate listing|bad request|HTTP 400/i.test(reason)) {
    return "This listing may already be on eBay's Inventory model, be an auction/variation listing, or need a SKU added in Seller Hub.";
  }
  if (/Accept-Language/i.test(reason)) {
    return "eBay rejected the locale header. Make sure the latest app version is deployed.";
  }
  if (/Invalid access token|1001/i.test(reason)) {
    return "eBay session expired — disconnect and reconnect eBay in Sync Stores.";
  }
  if (/25709|Content-Language/i.test(reason)) {
    return "eBay rejected a content locale header during listing sync.";
  }
  if (/business polic|fulfillmentPolicy|paymentPolicy|returnPolicy|merchant location/i.test(reason)) {
    return "Add payment, return, and shipping policies plus a merchant location in eBay Seller Hub.";
  }
  return undefined;
}

export function describeChannelSyncError(provider: string, e: unknown): string {
  if (provider === "ebay") return describeEbayThrownError(e);
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}
