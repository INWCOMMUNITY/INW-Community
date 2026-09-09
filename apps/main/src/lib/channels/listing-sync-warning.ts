import { CHANNEL_PROVIDER_LABELS } from "./provider-ui";
import {
  readEbayListingEnded,
  readRemoteCatalogState,
  readRemoteDeletedNotice,
} from "./listing-conflict-json";
import { isEbayPhotoHostFamilySyncError } from "./ebay/errors";
import {
  etsyVariesByAllProperties,
  isMadeToOrderTracking,
  MAX_ETSY_AXES,
  MAX_ETSY_SKUS_ALL_PROPERTIES,
  MAX_SKU_ROWS_EBAY,
  MAX_SKU_ROWS_SHOPIFY,
  matrixHasLinkedOptionPhotos,
  normalizeVariantMatrix,
} from "@/lib/listing-variant-matrix";

export const SELLER_CHANNEL_LINK_SELECT = {
  provider: true,
  syncStatus: true,
  syncEnabled: true,
  externalListingId: true,
  syncError: true,
  conflictDetails: true,
  connection: { select: { status: true } },
} as const;

function ebayExternalIdLooksLive(id: string | null | undefined): boolean {
  const trimmed = (id ?? "").trim();
  if (!trimmed) return false;
  if (/^\d{9,15}$/.test(trimmed)) return true;
  return /^inw\d{9,15}$/i.test(trimmed);
}

/** Hide the shop pill unless this item is actually live on that shop. */
export function channelLinkShowsOnItem(link: {
  provider?: string;
  externalListingId?: string | null;
  remoteDeletedProvider?: string | null;
  connectionStatus?: string | null;
  ebayListingEnded?: boolean;
  remoteCatalogState?: string | null;
  conflictDetails?: unknown;
  connection?: { status?: string } | null;
}): boolean {
  const remoteDeletedProvider =
    link.remoteDeletedProvider ??
    readRemoteDeletedNotice(link.conflictDetails)?.provider ??
    null;
  if (remoteDeletedProvider) return false;
  const connectionStatus = link.connectionStatus ?? link.connection?.status ?? null;
  if (connectionStatus === "disconnected") return false;
  const ebayListingEnded = link.ebayListingEnded ?? readEbayListingEnded(link.conflictDetails);
  if (ebayListingEnded) return false;
  if (
    (link.provider ?? "").toLowerCase() === "ebay" &&
    typeof link.externalListingId === "string" &&
    !ebayExternalIdLooksLive(link.externalListingId)
  ) {
    return false;
  }
  const remoteCatalogState =
    link.remoteCatalogState ?? readRemoteCatalogState(link.conflictDetails);
  if (
    remoteCatalogState === "inactive" ||
    remoteCatalogState === "inactive_outside_catalog" ||
    remoteCatalogState === "linked_other_channel"
  ) {
    return false;
  }
  return true;
}

export function listingChannelSyncWarning(link: {
  provider: string;
  syncStatus: string;
  syncEnabled: boolean;
  syncError?: string | null;
  connectionStatus?: string | null;
}): string | null {
  const label = CHANNEL_PROVIDER_LABELS[link.provider] ?? link.provider;
  // Intentional store disconnect: do not nag reconnect on every listing.
  if (link.connectionStatus === "disconnected") return null;
  if (link.connectionStatus === "error") {
    return `Not syncing to ${label} — reconnect in Sync Stores.`;
  }
  if (!link.syncEnabled) return `${label} sync is paused.`;
  if (link.syncStatus === "error") {
    if (link.provider === "ebay" && isEbayPhotoHostFamilySyncError(link.syncError)) {
      return null;
    }
    const detail = link.syncError?.trim();
    return detail ? `${label}: ${detail}` : `Not syncing to ${label}.`;
  }
  return null;
}

export function withListingChannelSyncWarning(link: {
  provider: string;
  syncStatus: string;
  syncEnabled: boolean;
  externalListingId: string;
  syncError?: string | null;
  conflictDetails?: unknown;
  connection?: { status: string } | null;
}) {
  const connectionStatus = link.connection?.status ?? "active";
  const notice = readRemoteDeletedNotice(link.conflictDetails);
  // Hide the shop tag after a remote delete, including after "Keep on INW".
  // Pending-only hid the tag until Keep, then the green Wix pill came back.
  const remoteDeletedProvider = notice ? notice.provider : null;
  const ebayListingEnded = readEbayListingEnded(link.conflictDetails);
  const remoteCatalogState = readRemoteCatalogState(link.conflictDetails);
  return {
    provider: link.provider,
    syncStatus: link.syncStatus,
    syncEnabled: link.syncEnabled,
    externalListingId: link.externalListingId,
    syncError: link.syncError ?? null,
    connectionStatus,
    remoteDeletedProvider,
    ebayListingEnded,
    remoteCatalogState,
    syncWarning: listingChannelSyncWarning({
      provider: link.provider,
      syncStatus: link.syncStatus,
      syncEnabled: link.syncEnabled,
      syncError: link.syncError,
      connectionStatus,
    }),
  };
}

/** Seller-facing notes when a matrix cannot map 1:1 onto a linked marketplace. */
export function listingVariantChannelWarnings(args: {
  variants: unknown;
  inventoryTracking?: string | null;
  linkedProviders: string[];
}): string[] {
  const providers = args.linkedProviders.map((p) => p.toLowerCase());
  if (providers.length === 0) return [];
  const out: string[] = [];
  const matrix = normalizeVariantMatrix(args.variants);
  const mto = isMadeToOrderTracking(args.inventoryTracking);

  if (providers.includes("etsy") && matrix && matrix.axes.length > MAX_ETSY_AXES) {
    out.push(
      `This item cannot be listed on Etsy — Etsy allows at most ${MAX_ETSY_AXES} option types. Remove an option type or unsync Etsy.`
    );
  }
  if (
    providers.includes("etsy") &&
    matrix &&
    etsyVariesByAllProperties(matrix) &&
    matrix.skus.length > MAX_ETSY_SKUS_ALL_PROPERTIES
  ) {
    out.push(
      `This item cannot be listed on Etsy — when price, quantity, or SKU varies across all three option types, Etsy allows at most ${MAX_ETSY_SKUS_ALL_PROPERTIES} combinations.`
    );
  }
  if (providers.includes("shopify") && matrix && matrix.skus.length > MAX_SKU_ROWS_SHOPIFY) {
    out.push(
      `This item cannot be listed on Shopify — Shopify (REST sync) supports at most ${MAX_SKU_ROWS_SHOPIFY} combinations. Reduce options or unsync Shopify.`
    );
  }
  if (providers.includes("ebay") && matrix && matrix.skus.length > MAX_SKU_ROWS_EBAY) {
    out.push(
      `This item cannot be listed on eBay — eBay supports at most ${MAX_SKU_ROWS_EBAY} variations. Reduce combinations or unsync eBay.`
    );
  }
  if (providers.includes("ebay") && matrix && matrix.axes.length > 1) {
    out.push(
      "eBay can only vary listing pictures by one option type (usually Color). Other combinations share those photos."
    );
  }
  if (providers.includes("wix") && matrix && matrixHasLinkedOptionPhotos(matrix)) {
    out.push(
      "Wix will show the main gallery; color photos stay on INW and other shops."
    );
  }
  if (mto && providers.some((p) => p === "ebay" || p === "etsy")) {
    out.push(
      "Made-to-order listings send a placeholder quantity to eBay and Etsy (they do not support unlimited stock)."
    );
  }
  return out;
}
