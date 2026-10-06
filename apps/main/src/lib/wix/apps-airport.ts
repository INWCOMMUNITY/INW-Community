/** Apps Airport Wix seller routes and display helpers. Isolated from Shopify and Etsy modules. */

export const APPS_AIRPORT_PATH = "/seller-hub/apps";
export const APPS_AIRPORT_WIX_PATH = `${APPS_AIRPORT_PATH}/wix`;
export const APPS_AIRPORT_WIX_SETTINGS_PATH = `${APPS_AIRPORT_WIX_PATH}/settings`;
export const APPS_AIRPORT_WIX_SYNC_PATH = `${APPS_AIRPORT_WIX_PATH}/sync`;
export const APPS_AIRPORT_WIX_LISTINGS_PATH = `${APPS_AIRPORT_WIX_PATH}/listings`;
export const APPS_AIRPORT_WIX_IMPORT_PATH = `${APPS_AIRPORT_WIX_PATH}/import`;

export type WixConnectionUiStatus = "connected" | "disconnected" | "needs_attention";

export type WixListingUiStatus = "Live" | "Needs attention" | "Unpublished" | "Syncing";

export const APPS_AIRPORT_WIX_HUB = {
  id: "wix" as const,
  displayName: "Wix",
  hubPath: APPS_AIRPORT_WIX_PATH,
  importPath: APPS_AIRPORT_WIX_IMPORT_PATH,
  listItemsPath: APPS_AIRPORT_WIX_SYNC_PATH,
  settingsPath: APPS_AIRPORT_WIX_SETTINGS_PATH,
  listingsPath: APPS_AIRPORT_WIX_LISTINGS_PATH,
  importLabel: "Import Listings",
  listItemsLabel: "List Items on Wix",
  settingsLabel: "Connection Settings",
  viewOnChannelLabel: "View on Wix",
  openAdminLabel: "Open Wix Dashboard",
};

export function classifyWixConnectionUi(input: {
  connected: boolean;
  health?: "healthy" | "degraded" | "disconnected" | "not_configured";
} | null): WixConnectionUiStatus {
  if (!input?.connected) return "disconnected";
  if (input.health === "degraded") return "needs_attention";
  return "connected";
}

export function wixConnectionStatusLabel(status: WixConnectionUiStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "needs_attention":
      return "Needs attention";
    case "disconnected":
      return "Not connected";
  }
}

export function appsAirportWixHubTitle(displayName: string, connectionStatusLabel: string): string {
  return `${displayName} (${connectionStatusLabel})`;
}

export function wixListingUiStatus(input: {
  readiness?: string | null;
  contentHealth?: string | null;
  inventoryHealth?: string | null;
  issueCode?: string | null;
  storeItemStatus?: string | null;
  remoteProductVisible?: boolean | null;
}): WixListingUiStatus {
  if (input.storeItemStatus === "ended" || input.storeItemStatus === "draft") {
    return "Unpublished";
  }
  const hiddenOnWix = input.remoteProductVisible === false;
  if (
    input.readiness === "ACTION_REQUIRED" ||
    input.readiness === "CONNECTION_REQUIRED" ||
    input.contentHealth === "PAUSED" ||
    input.inventoryHealth === "PAUSED" ||
    Boolean(input.issueCode) ||
    hiddenOnWix
  ) {
    return "Needs attention";
  }
  if (input.readiness === "SYNCING") {
    return "Syncing";
  }
  if (input.contentHealth === "DEGRADED" || input.inventoryHealth === "DEGRADED") {
    return "Needs attention";
  }
  if (input.readiness === "READY_TO_PUBLISH") {
    return "Live";
  }
  return "Syncing";
}

export function wixListingStatusChipClass(status: WixListingUiStatus): string {
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

export function formatWixCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export type WixSyncProgressStep =
  | "preparing"
  | "queued"
  | "creating"
  | "live"
  | "needs_attention"
  | "already_mapped";

export function wixSyncProgressLabel(step: WixSyncProgressStep): string {
  switch (step) {
    case "preparing":
      return "Preparing";
    case "queued":
      return "Queued — starting worker";
    case "creating":
      return "Creating product on Wix";
    case "live":
      return "Live on Wix";
    case "needs_attention":
      return "Needs attention";
    case "already_mapped":
      return "Already linked";
  }
}

export function resolveWixSyncProgress(input: {
  enqueueStatus?: "queued" | "already_mapped" | null;
  listing?: {
    readiness?: string | null;
    remoteProductVisible?: boolean | null;
    issueMessage?: string | null;
  } | null;
}): WixSyncProgressStep {
  if (input.enqueueStatus === "already_mapped") return "already_mapped";
  if (
    input.listing?.readiness === "READY_TO_PUBLISH" &&
    input.listing.remoteProductVisible !== false
  ) {
    return "live";
  }
  if (
    input.listing?.readiness === "ACTION_REQUIRED" ||
    input.listing?.readiness === "CONNECTION_REQUIRED"
  ) {
    return "needs_attention";
  }
  if (input.listing) return "creating";
  if (input.enqueueStatus === "queued") return "queued";
  return "preparing";
}
