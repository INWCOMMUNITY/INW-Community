/** Apps Airport seller routes and display helpers. */

export const APPS_AIRPORT_PATH = "/seller-hub/apps";
export const APPS_AIRPORT_SHOPIFY_PATH = `${APPS_AIRPORT_PATH}/shopify`;
export const APPS_AIRPORT_SHOPIFY_SYNC_PATH = `${APPS_AIRPORT_SHOPIFY_PATH}/sync`;
export const APPS_AIRPORT_SHOPIFY_LISTINGS_PATH = `${APPS_AIRPORT_SHOPIFY_PATH}/listings`;
export const APPS_AIRPORT_SHOPIFY_IMPORT_PATH = `${APPS_AIRPORT_SHOPIFY_PATH}/import`;
export const APPS_AIRPORT_SHOPIFY_SETTINGS_PATH = `${APPS_AIRPORT_SHOPIFY_PATH}/settings`;

export type MarketplaceCardAvailability = "available" | "coming_later";

export type MarketplaceCardDef = {
  id: "shopify" | "ebay" | "etsy" | "wix";
  name: string;
  availability: MarketplaceCardAvailability;
  href?: string;
  description: string;
};

export const APPS_AIRPORT_MARKETPLACES: MarketplaceCardDef[] = [
  {
    id: "shopify",
    name: "Shopify",
    availability: "available",
    href: APPS_AIRPORT_SHOPIFY_PATH,
    description: "Sync INW listings to your Shopify store.",
  },
  {
    id: "ebay",
    name: "eBay",
    availability: "coming_later",
    description: "Coming later — not available in Apps Airport yet.",
  },
  {
    id: "etsy",
    name: "Etsy",
    availability: "coming_later",
    description: "Coming later — not available in Apps Airport yet.",
  },
  {
    id: "wix",
    name: "Wix",
    availability: "coming_later",
    description: "Coming later — not available in Apps Airport yet.",
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
      return "Ready to publish";
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
  | "creating_draft"
  | "mapping"
  | "inventory_initializing"
  | "ready_to_publish"
  | "needs_attention"
  | "already_mapped";

export function shopifySyncProgressLabel(step: ShopifySyncProgressStep): string {
  switch (step) {
    case "preparing":
      return "Preparing";
    case "queued":
      return "Queued";
    case "creating_draft":
      return "Creating Shopify draft";
    case "mapping":
      return "Mapping";
    case "inventory_initializing":
      return "Inventory initializing";
    case "ready_to_publish":
      return "Ready to publish";
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
  } | null;
}): ShopifySyncProgressStep {
  if (input.enqueueStatus === "already_mapped" && !input.listing) return "already_mapped";
  if (!input.listing) {
    if (input.enqueueStatus === "queued") return "creating_draft";
    return "preparing";
  }
  if (input.listing.readiness === "READY_TO_PUBLISH") return "ready_to_publish";
  if (input.listing.readiness === "ACTION_REQUIRED" || input.listing.readiness === "CONNECTION_REQUIRED") {
    return "needs_attention";
  }
  if (input.listing.inventoryInitState === "PENDING") return "inventory_initializing";
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

export function formatCents(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
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
