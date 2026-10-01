/** Apps Airport Etsy seller routes and display helpers. Isolated from Shopify modules. */

export const APPS_AIRPORT_PATH = "/seller-hub/apps";
export const APPS_AIRPORT_ETSY_PATH = `${APPS_AIRPORT_PATH}/etsy`;
export const APPS_AIRPORT_ETSY_SETTINGS_PATH = `${APPS_AIRPORT_ETSY_PATH}/settings`;
export const APPS_AIRPORT_ETSY_SYNC_PATH = `${APPS_AIRPORT_ETSY_PATH}/sync`;
export const APPS_AIRPORT_ETSY_LISTINGS_PATH = `${APPS_AIRPORT_ETSY_PATH}/listings`;
export const APPS_AIRPORT_ETSY_IMPORT_PATH = `${APPS_AIRPORT_ETSY_PATH}/import`;

export type EtsyConnectionUiStatus = "connected" | "disconnected";

export type EtsyListingUiStatus = "Live" | "Needs attention" | "Unpublished" | "Syncing";

export function classifyEtsyConnectionUi(input: {
  status?: string | null;
} | null): EtsyConnectionUiStatus {
  if (!input || input.status !== "ACTIVE") return "disconnected";
  return "connected";
}

export function etsyConnectionStatusLabel(status: EtsyConnectionUiStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "disconnected":
      return "Not connected";
  }
}

export function appsAirportEtsyHubTitle(
  displayName: string,
  connectionStatusLabel: string
): string {
  return `${displayName} (${connectionStatusLabel})`;
}

export function etsyListingUiStatus(input: {
  readiness?: string | null;
  contentHealth?: string | null;
  inventoryHealth?: string | null;
  issueCode?: string | null;
  storeItemStatus?: string | null;
  /** Buyer-live only when Etsy remote state is active — drafts must not show as Live. */
  remoteListingState?: string | null;
}): EtsyListingUiStatus {
  if (input.storeItemStatus === "ended" || input.storeItemStatus === "draft") {
    return "Unpublished";
  }
  if (
    input.readiness === "ACTION_REQUIRED" ||
    input.readiness === "CONNECTION_REQUIRED" ||
    input.contentHealth === "PAUSED" ||
    input.inventoryHealth === "PAUSED" ||
    input.contentHealth === "DEGRADED" ||
    input.inventoryHealth === "DEGRADED" ||
    Boolean(input.issueCode)
  ) {
    return "Needs attention";
  }
  const remoteActive = etsyListingIsPubliclyViewable(input.remoteListingState);
  if (!remoteActive) {
    // Mapped draft / activate-pending — never "Live" until Etsy state is active.
    if (input.readiness === "SYNCING") return "Syncing";
    return "Needs attention";
  }
  if (input.readiness === "READY_TO_PUBLISH") return "Live";
  return "Syncing";
}

export function etsyListingStatusChipClass(status: EtsyListingUiStatus): string {
  switch (status) {
    case "Live":
      return "bg-[var(--color-section-alt)] text-[var(--color-heading)] border-[var(--color-heading)]/25";
    case "Unpublished":
      return "bg-neutral-100 text-neutral-700 border-neutral-300";
    case "Needs attention":
      return "bg-amber-50 text-amber-900 border-amber-200";
    case "Syncing":
      return "bg-sky-50 text-sky-900 border-sky-200";
  }
}

export function formatEtsyCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export const APPS_AIRPORT_ETSY_HUB = {
  id: "etsy" as const,
  displayName: "Etsy",
  hubPath: APPS_AIRPORT_ETSY_PATH,
  importPath: APPS_AIRPORT_ETSY_IMPORT_PATH,
  listItemsPath: APPS_AIRPORT_ETSY_SYNC_PATH,
  settingsPath: APPS_AIRPORT_ETSY_SETTINGS_PATH,
  listingsPath: APPS_AIRPORT_ETSY_LISTINGS_PATH,
  importLabel: "Import Listings",
  listItemsLabel: "List Items on Etsy",
  settingsLabel: "Connection Settings",
  viewOnChannelLabel: "View on Etsy",
  openAdminLabel: "Open Etsy Shop Manager",
};

/** Public buyer URL is only valid for active Etsy listings. */
export function etsyListingIsPubliclyViewable(remoteListingState?: string | null): boolean {
  return String(remoteListingState ?? "").trim().toLowerCase() === "active";
}

/** Buyer-facing listing URL, or null when the listing is still draft / not live. */
export function etsyListingPublicUrl(input: {
  etsyListingId?: string | null;
  remoteListingState?: string | null;
}): string | null {
  const id = String(input.etsyListingId ?? "").trim();
  if (!/^\d+$/.test(id)) return null;
  if (!etsyListingIsPubliclyViewable(input.remoteListingState)) return null;
  return `https://www.etsy.com/listing/${id}`;
}

/** True once E4 import routes are live. */
export const ETSY_IMPORT_ENABLED = true;

/**
 * Silent platform taxonomy fallback when listing + connection omit taxonomy_id.
 * Overridable via ETSY_DEFAULT_TAXONOMY_ID.
 * Must be a seller-taxonomy *leaf* id (Etsy rejects parents / unknown ids with 400).
 * Leaf: Art & Collectibles › Mixed Media & Collage › Other Assemblage.
 * @see https://developer.etsy.com/documentation/tutorials/listings
 */
export const ETSY_PLATFORM_DEFAULT_TAXONOMY_ID = 101;

/** Previously shipped bogus fallback (looked like a shop id). Never send to Etsy. */
export const ETSY_KNOWN_INVALID_TAXONOMY_IDS = new Set<number>([69150467]);

export type EtsySyncProgressStep =
  | "preparing"
  | "queued"
  | "creating"
  | "activating"
  | "live"
  | "needs_attention"
  | "already_mapped";

export function etsySyncProgressLabel(step: EtsySyncProgressStep): string {
  switch (step) {
    case "preparing":
      return "Preparing";
    case "queued":
      return "Queued — starting worker";
    case "creating":
      return "Creating listing on Etsy";
    case "activating":
      return "Activating on Etsy";
    case "live":
      return "Live on Etsy";
    case "needs_attention":
      return "Needs attention";
    case "already_mapped":
      return "Already linked";
  }
}

/** Progress percent for the seller-facing bar (approximate). */
export function etsySyncProgressPercent(step: EtsySyncProgressStep): number {
  switch (step) {
    case "preparing":
      return 10;
    case "queued":
      return 25;
    case "creating":
      return 55;
    case "activating":
      return 80;
    case "live":
    case "already_mapped":
      return 100;
    case "needs_attention":
      return 100;
  }
}

export function resolveEtsySyncProgress(input: {
  enqueueStatus?: "queued" | "already_mapped" | null;
  jobState?: string | null;
  jobError?: string | null;
  listing?: {
    readiness?: string | null;
    remoteListingState?: string | null;
    issueMessage?: string | null;
  } | null;
}): EtsySyncProgressStep {
  if (input.enqueueStatus === "already_mapped") return "already_mapped";
  if (
    input.listing?.readiness === "READY_TO_PUBLISH" &&
    etsyListingIsPubliclyViewable(input.listing.remoteListingState)
  ) {
    return "live";
  }
  if (
    input.listing?.readiness === "ACTION_REQUIRED" ||
    input.listing?.readiness === "CONNECTION_REQUIRED" ||
    input.jobState === "DEAD"
  ) {
    return "needs_attention";
  }
  if (input.listing) {
    const remote = String(input.listing.remoteListingState ?? "").toLowerCase();
    if (remote === "draft" || input.listing.readiness === "SYNCING") return "activating";
    return "activating";
  }
  if (input.jobState === "RUNNING") return "creating";
  if (input.jobState === "PENDING" || input.jobState === "RETRY_WAIT") return "queued";
  if (input.enqueueStatus === "queued") return "creating";
  return "preparing";
}
