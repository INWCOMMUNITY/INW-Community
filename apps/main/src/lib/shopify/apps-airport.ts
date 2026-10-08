/** Sync Airport seller routes and display helpers. */

export const APPS_AIRPORT_PATH = "/seller-hub/apps";
export const APPS_AIRPORT_SHOPIFY_PATH = `${APPS_AIRPORT_PATH}/shopify`;
export const APPS_AIRPORT_SHOPIFY_SYNC_PATH = `${APPS_AIRPORT_SHOPIFY_PATH}/sync`;
export const APPS_AIRPORT_SHOPIFY_LISTINGS_PATH = `${APPS_AIRPORT_SHOPIFY_PATH}/listings`;
export const APPS_AIRPORT_SHOPIFY_IMPORT_PATH = `${APPS_AIRPORT_SHOPIFY_PATH}/import`;
export const APPS_AIRPORT_SHOPIFY_SETTINGS_PATH = `${APPS_AIRPORT_SHOPIFY_PATH}/settings`;

export type MarketplaceCardAvailability = "available" | "coming_later";

export type AppsAirportChannelId = "shopify" | "ebay" | "etsy" | "wix" | "inw";

export type MarketplaceCardDef = {
  id: Exclude<AppsAirportChannelId, "inw" | "ebay">;
  name: string;
  /** Ionicons name shown beside the marketplace title (not on action buttons). */
  icon: string;
  availability: MarketplaceCardAvailability;
  href?: string;
  description: string;
};

/** Contract for channel hub pages — Shopify is filled; others match later. */
export type AppsAirportChannelHubConfig = {
  id: Exclude<AppsAirportChannelId, "inw">;
  displayName: string;
  /** Ionicons name for View On / marketplace chrome (not action menus). */
  icon: string;
  hubPath: string;
  importPath: string;
  listItemsPath: string;
  settingsPath: string;
  listingsPath: string;
  importLabel: string;
  listItemsLabel: string;
  settingsLabel: string;
  viewOnChannelLabel: string;
  openAdminLabel: string;
  /** Seller dashboard (generic — not a single-store deep link). */
  openDashboardLabel: string;
  dashboardUrl: string;
};

/** Generic Shopify Admin entry (resolves to the signed-in merchant). */
export const SHOPIFY_SELLER_DASHBOARD_URL = "https://admin.shopify.com/";

export const APPS_AIRPORT_SHOPIFY_HUB: AppsAirportChannelHubConfig = {
  id: "shopify",
  displayName: "Shopify",
  icon: "bag-handle-outline",
  hubPath: APPS_AIRPORT_SHOPIFY_PATH,
  importPath: APPS_AIRPORT_SHOPIFY_IMPORT_PATH,
  listItemsPath: APPS_AIRPORT_SHOPIFY_SYNC_PATH,
  settingsPath: APPS_AIRPORT_SHOPIFY_SETTINGS_PATH,
  listingsPath: APPS_AIRPORT_SHOPIFY_LISTINGS_PATH,
  importLabel: "Import Listings",
  listItemsLabel: "List Items on Shopify",
  settingsLabel: "Connection Settings",
  viewOnChannelLabel: "View On Shopify",
  openAdminLabel: "Open Shopify Admin",
  openDashboardLabel: "Open Shopify Dashboard",
  dashboardUrl: SHOPIFY_SELLER_DASHBOARD_URL,
};

export function appsAirportChannelHubTitle(
  displayName: string,
  connectionStatusLabel: string
): string {
  return `${displayName} (${connectionStatusLabel})`;
}

const SYNCED_WITH_LABELS: Record<AppsAirportChannelId, string> = {
  inw: "INW",
  shopify: "Shopify",
  ebay: "eBay",
  etsy: "Etsy",
  wix: "Wix",
};

/** Ordered display for the Synced with column (INW first, then other channels). */
export function formatSyncedWithChannels(channels: AppsAirportChannelId[]): string {
  const seen = new Set<AppsAirportChannelId>();
  const rest: AppsAirportChannelId[] = [];
  for (const id of channels) {
    if (id === "inw" || seen.has(id)) continue;
    seen.add(id);
    rest.push(id);
  }
  const ordered: AppsAirportChannelId[] = ["inw", ...rest];
  return ordered.map((id) => SYNCED_WITH_LABELS[id]).join(", ");
}

export const APPS_AIRPORT_MARKETPLACES: MarketplaceCardDef[] = [
  {
    id: "shopify",
    name: "Shopify",
    icon: "bag-handle-outline",
    availability: "available",
    href: APPS_AIRPORT_SHOPIFY_PATH,
    description: "Sync INW listings to your Shopify store.",
  },
  {
    id: "etsy",
    name: "Etsy",
    icon: "color-palette-outline",
    availability: "available",
    href: "/seller-hub/apps/etsy",
    description: "Connect your Etsy shop, set How it’s made on listings, then list from Sync Airport.",
  },
  {
    id: "wix",
    name: "Wix",
    icon: "globe-outline",
    availability: "available",
    href: "/seller-hub/apps/wix",
    description: "Sync INW listings with your Wix store.",
  },
];

export type ShopifyConnectionUiStatus = "connected" | "needs_attention" | "disconnected";

export function classifyShopifyConnectionUi(input: {
  status?: string | null;
  inventoryReady?: boolean;
  locationSelectionRequired?: boolean;
} | null): ShopifyConnectionUiStatus {
  if (!input || input.status !== "ACTIVE") return "disconnected";
  if (input.locationSelectionRequired || !input.inventoryReady) return "needs_attention";
  return "connected";
}

export function shopifyConnectionStatusLabel(status: ShopifyConnectionUiStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "needs_attention":
      return "Needs attention";
    default:
      return "Not connected";
  }
}

export function shopifyReadinessLabel(readiness: string | null | undefined): string {
  switch (readiness) {
    case "READY_TO_PUBLISH":
      return "Live";
    case "ACTION_REQUIRED":
      return "Needs attention";
    case "CONNECTION_REQUIRED":
      return "Connection required";
    case "SYNCING":
      return "Syncing";
    default:
      return readiness?.trim() ? readiness : "Unknown";
  }
}

export type ShopifyListingUiStatus = "Live" | "Unpublished" | "Needs attention" | "Syncing";

/** Seller-facing status for synced listing rows (chips + filters). */
export function shopifyListingUiStatus(input: {
  readiness?: string | null;
  contentHealth?: string | null;
  inventoryHealth?: string | null;
  issueCode?: string | null;
}): ShopifyListingUiStatus {
  const code = String(input.issueCode ?? "");
  if (code === "UNPUBLISHED_ONLINE_STORE" || code === "UNPUBLISH_PARTIAL") {
    return "Unpublished";
  }
  if (
    input.readiness === "ACTION_REQUIRED" ||
    input.readiness === "CONNECTION_REQUIRED" ||
    input.contentHealth === "PAUSED" ||
    input.inventoryHealth === "PAUSED" ||
    code === "INVENTORY_REMOTE_DRIFT" ||
    code.startsWith("INVENTORY_")
  ) {
    return "Needs attention";
  }
  // Still publishing or catching up. Degraded health here is progress, not a broken link.
  if (input.readiness === "SYNCING" || input.readiness === "READY_TO_PUBLISH") {
    return input.readiness === "READY_TO_PUBLISH" ? "Live" : "Syncing";
  }
  return "Syncing";
}

const SELLER_ISSUE_COPY: Record<string, string> = {
  REMOTE_VARIANT_MISSING:
    "This item is still linked to a Shopify product, but the options no longer match. Use Reconnect listing to match them again.",
  REMOTE_PRODUCT_MISSING:
    "The Shopify product this item was linked to is gone. Use Reconnect listing to list it again.",
  OPTIONS_NOT_PUSHED:
    "Color and size changes did not reach Shopify. Use Reconnect listing to try again.",
  OPTIONS_NOT_MATCHED:
    "Shopify has the product, but the color and size options do not line up with INW. Use Reconnect listing.",
  TOPOLOGY_UNMAPPED_VARIANTS:
    "Shopify has options that INW has not matched yet. Use Reconnect listing.",
  TOPOLOGY_AXIS_CONFLICT:
    "The options on Shopify and INW no longer fit together. Use Reconnect listing, or edit the options so both sides match.",
  INVENTORY_REMOTE_DRIFT:
    "Shopify quantity differs from INW. Quantity updates are paused so a sale is not overwritten. Use Reconnect listing after you check the quantity.",
  INVENTORY_INIT_FAILED:
    "Shopify did not accept the quantity, so this item was not published. Use Reconnect listing to try again.",
  INVENTORY_LEVEL_MISSING:
    "Shopify has no quantity at your selected location. Pick the location in connection settings, then use Reconnect listing.",
};

/** Seller-facing detail under Needs attention (never raw GraphQL codes alone). */
export function shopifyListingIssueSellerDetail(input: {
  issueCode?: string | null;
  issueMessage?: string | null;
}): string | null {
  const code = String(input.issueCode ?? "");
  if (SELLER_ISSUE_COPY[code]) return SELLER_ISSUE_COPY[code];
  const msg = input.issueMessage?.trim();
  return msg || null;
}

/** One sentence under a listing row. Drafts and paused links always say what to do. */
export function shopifyListingSellerNote(input: {
  status: ShopifyListingUiStatus;
  issueCode?: string | null;
  issueMessage?: string | null;
  remoteProductStatus?: string | null;
}): string | null {
  const detail = shopifyListingIssueSellerDetail(input);
  if (detail && input.status !== "Live") return detail;
  if (String(input.remoteProductStatus ?? "").toUpperCase() === "DRAFT") {
    return "This item is still a draft on Shopify, so shoppers cannot buy it yet. Use Reconnect listing to publish it.";
  }
  if (input.status === "Needs attention") {
    return "Updates are paused. Use Reconnect listing to match this item to the Shopify product again.";
  }
  return null;
}

/** @deprecated Prefer shopifyListingUiStatus — kept for older call sites. */
export function shopifyListingLiveLabel(input: {
  readiness?: string | null;
  contentHealth?: string | null;
  inventoryHealth?: string | null;
  issueCode?: string | null;
}): ShopifyListingUiStatus {
  return shopifyListingUiStatus(input);
}

export function shopifyListingStatusChipClass(status: ShopifyListingUiStatus): string {
  switch (status) {
    case "Live":
      // Theme tan + brown (section-alt / heading)
      return "bg-[var(--color-section-alt)] text-[var(--color-heading)] border-[var(--color-heading)]/25";
    case "Unpublished":
      return "bg-neutral-100 text-neutral-700 border-neutral-300";
    case "Needs attention":
      return "bg-amber-50 text-amber-900 border-amber-200";
    case "Syncing":
      return "bg-sky-50 text-sky-900 border-sky-200";
  }
}

export function shopifyConnectionStatusChipClass(status: ShopifyConnectionUiStatus): string {
  switch (status) {
    case "connected":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "needs_attention":
      return "bg-amber-50 text-amber-900 border-amber-200";
    default:
      return "bg-neutral-100 text-neutral-700 border-neutral-300";
  }
}

/** Seller-facing remount progress (never show raw job codes as the primary line). */
export function shopifyRemountSellerCopy(remount: {
  state?: string | null;
  message?: string | null;
  errorCode?: string | null;
} | null): { tone: "idle" | "progress" | "error" | "done"; title: string; detail: string | null } {
  if (!remount?.state) {
    return { tone: "idle", title: "", detail: null };
  }
  const state = String(remount.state).toUpperCase();
  if (state === "PENDING" || state === "RUNNING" || state === "RETRY_WAIT") {
    return {
      tone: "progress",
      title: "Restoring listings after reconnect…",
      detail: "This usually finishes within a minute. Listing actions may be briefly delayed.",
    };
  }
  if (state === "DEAD") {
    return {
      tone: "error",
      title: "Could not restore some listings after reconnect",
      detail:
        remount.message?.trim() ||
        "Open a listing and use Retry sync, or List on Shopify again.",
    };
  }
  if (state === "SUCCEEDED") {
    if (remount.errorCode === "REMOUNT_PARTIAL" || remount.message) {
      return {
        tone: "done",
        title: "Reconnect restore finished with notes",
        detail: remount.message?.trim() || null,
      };
    }
    return { tone: "done", title: "Listings restored for this connection", detail: null };
  }
  return { tone: "idle", title: "", detail: null };
}

export function shopifyHealthLabel(health: string | null | undefined): string {
  switch (health) {
    case "HEALTHY":
      return "Healthy";
    case "DEGRADED":
      return "Degraded";
    case "PAUSED":
      return "Paused";
    default:
      return health?.trim() ? health : "Unknown";
  }
}

/** Friendly sync-creation steps from enqueue + listing readiness. */
export type ShopifySyncProgressStep =
  | "preparing"
  | "queued"
  | "creating_product"
  | "mapping"
  | "inventory_initializing"
  | "publishing"
  | "published"
  | "needs_attention"
  | "already_mapped";

export function shopifySyncProgressLabel(step: ShopifySyncProgressStep): string {
  switch (step) {
    case "preparing":
      return "Preparing";
    case "queued":
      return "Queued";
    case "creating_product":
      return "Creating Shopify product";
    case "mapping":
      return "Mapping";
    case "inventory_initializing":
      return "Initializing inventory";
    case "publishing":
      return "Publishing to Online Store";
    case "published":
      return "Live on Online Store";
    case "needs_attention":
      return "Needs attention";
    case "already_mapped":
      return "Already synced";
  }
}

export function resolveShopifySyncProgress(input: {
  enqueueStatus?: "queued" | "already_mapped" | null;
  listing?: {
    readiness?: string | null;
    inventoryInitState?: string | null;
    remoteProductStatus?: string | null;
  } | null;
}): ShopifySyncProgressStep {
  if (input.enqueueStatus === "already_mapped" && !input.listing) return "already_mapped";
  if (!input.listing) {
    if (input.enqueueStatus === "queued") return "creating_product";
    return "preparing";
  }
  if (input.listing.readiness === "READY_TO_PUBLISH") return "published";
  if (input.listing.readiness === "ACTION_REQUIRED" || input.listing.readiness === "CONNECTION_REQUIRED") {
    return "needs_attention";
  }
  if (input.listing.inventoryInitState === "PENDING") return "inventory_initializing";
  if (
    input.listing.inventoryInitState === "INITIALIZED" ||
    input.listing.inventoryInitState === "NOT_APPLICABLE"
  ) {
    const remote = String(input.listing.remoteProductStatus ?? "").toUpperCase();
    if (remote !== "ACTIVE") return "publishing";
  }
  if (input.listing.readiness === "SYNCING") return "mapping";
  return "queued";
}

/** Safe Shopify Admin product URL from known domain + product GID. */
export function shopifyAdminProductUrl(
  shopDomain: string | null | undefined,
  shopifyProductId: string | null | undefined
): string | null {
  if (!shopDomain || !shopifyProductId) return null;
  const domain = shopDomain.trim().toLowerCase();
  if (!domain.endsWith(".myshopify.com")) return null;
  const match = shopifyProductId.match(/^gid:\/\/shopify\/Product\/(\d+)$/);
  if (!match) return null;
  return `https://${domain}/admin/products/${match[1]}`;
}

/** Storefront product URL when we know the Shopify handle. */
export function shopifyStorefrontProductUrl(
  shopDomain: string | null | undefined,
  handle: string | null | undefined
): string | null {
  if (!shopDomain || !handle) return null;
  const domain = shopDomain.trim().toLowerCase();
  if (!domain.endsWith(".myshopify.com")) return null;
  const clean = handle.trim().replace(/^\/+|\/+$/g, "");
  if (!clean) return null;
  return `https://${domain}/products/${encodeURIComponent(clean)}`;
}

export function formatCents(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function formatRelativeUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const delta = Date.now() - t;
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Synced Listings "Shopify" quantity: only show verified applied/observed stock.
 * Never fall back desired→Shopify qty (that falsely reported Healthy qty while PENDING).
 */
export function formatShopifyObservedQuantity(input: {
  inventoryAppliedAvailable: number | null | undefined;
  inventoryDesiredAvailable?: number | null | undefined;
}): string {
  if (
    typeof input.inventoryAppliedAvailable === "number" &&
    Number.isFinite(input.inventoryAppliedAvailable)
  ) {
    return String(input.inventoryAppliedAvailable);
  }
  if (
    typeof input.inventoryDesiredAvailable === "number" &&
    Number.isFinite(input.inventoryDesiredAvailable)
  ) {
    return `— (desired ${input.inventoryDesiredAvailable})`;
  }
  return "—";
}
