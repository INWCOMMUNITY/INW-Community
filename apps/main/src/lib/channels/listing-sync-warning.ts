import { CHANNEL_PROVIDER_LABELS } from "./provider-ui";
import { readRemoteDeletedNotice } from "./listing-link-flags";
import { isEbayPhotoHostFamilySyncError } from "./ebay/errors";
import {
  isMadeToOrderTracking,
  MAX_ETSY_AXES,
  MAX_SKU_ROWS_DEFAULT,
  MAX_SKU_ROWS_EBAY,
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

export function listingChannelSyncWarning(link: {
  provider: string;
  syncStatus: string;
  syncEnabled: boolean;
  syncError?: string | null;
  connectionStatus?: string | null;
}): string | null {
  const label = CHANNEL_PROVIDER_LABELS[link.provider] ?? link.provider;
  if (link.connectionStatus === "disconnected") {
    return `Not syncing to ${label} — store disconnected. Reconnect in Sync Stores.`;
  }
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
  return {
    provider: link.provider,
    syncStatus: link.syncStatus,
    syncEnabled: link.syncEnabled,
    externalListingId: link.externalListingId,
    syncError: link.syncError ?? null,
    connectionStatus,
    remoteDeletedProvider,
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
      "Etsy supports at most 2 option types. Remove an option type or unsync Etsy before publishing."
    );
  }
  if (providers.includes("shopify") && matrix && matrix.skus.length > MAX_SKU_ROWS_DEFAULT) {
    out.push("Shopify supports at most 100 combinations. Reduce options or unsync Shopify.");
  }
  if (providers.includes("ebay") && matrix && matrix.skus.length > MAX_SKU_ROWS_EBAY) {
    out.push("eBay supports at most 250 variations. Reduce combinations or unsync eBay.");
  }
  if (providers.includes("ebay") && matrix && matrix.axes.length > 1) {
    out.push(
      "eBay can only vary listing pictures by one option type (usually Color). Other combinations share those photos."
    );
  }
  if (mto && providers.some((p) => p === "ebay" || p === "etsy")) {
    out.push(
      "Made-to-order listings send a placeholder quantity to eBay and Etsy (they do not support unlimited stock)."
    );
  }
  return out;
}
