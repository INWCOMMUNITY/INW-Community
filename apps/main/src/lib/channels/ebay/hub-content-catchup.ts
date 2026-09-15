/**
 * Copy Seller Hub title/photos/description onto Inventory/offer (View Item),
 * never via INW fan-out. Qty/price stay on bulk_update; this PUT pins live warehouse qty.
 */

import type { SyncStoreItem } from "../types";
import { ebayJson } from "./client";
import { findEbayOfferForSku, fetchEbayOfferDetails } from "./bulk-update-price-quantity";
import { resolveEbayLivePushSku } from "./inventory-sku";
import {
  buildPassthroughLiveOverlayBody,
  detectLivePassthroughChanges,
  fetchLiveInventoryItem,
  overlayPassthroughOffer,
  type LiveInventoryItem,
} from "./passthrough-push";
import { mappedEbayInventorySku, parseEbaySkuMap, type EbaySkuMap } from "./sku-map";
import type { EbayItemDetails } from "./trading";

export function hubSnapshotAsSyncItem(
  details: Pick<EbayItemDetails, "title" | "description" | "inventoryPinPhotos">
): Pick<SyncStoreItem, "title" | "description" | "photos"> {
  return {
    title: (details.title ?? "").trim(),
    description: details.description,
    photos: details.inventoryPinPhotos ?? [],
  };
}

export function ebayHubContentNeedsInventoryWrite(
  live: LiveInventoryItem,
  hub: Pick<SyncStoreItem, "title" | "description" | "photos">,
  liveOffer?: Record<string, unknown> | null
): { title: boolean; photos: boolean; description: boolean } {
  if (!hub.title.trim()) return { title: false, photos: false, description: false };
  const stub = {
    title: hub.title,
    description: hub.description,
    photos: hub.photos,
    priceCents: 0,
    quantity: 0,
  } as SyncStoreItem;
  const changed = detectLivePassthroughChanges(live, stub, liveOffer);
  return {
    title: changed.title === true,
    photos: changed.photos === true && hub.photos.length > 0,
    description: changed.description === true,
  };
}

export async function catchupEbayListingHubContent(args: {
  accessToken: string;
  item: SyncStoreItem;
  externalListingId: string;
  linkOrigin?: string | null;
  skuMap?: unknown;
  hub: Pick<EbayItemDetails, "title" | "description" | "inventoryPinPhotos" | "sku">;
}): Promise<{ wrote: boolean }> {
  const map = parseEbaySkuMap(args.skuMap);
  const sku =
    mappedEbayInventorySku(map, args.item.sku) ??
    (await resolveEbayLivePushSku(args.accessToken, {
      itemId: args.item.id,
      itemSku: args.item.sku,
      externalListingId: args.externalListingId,
      linkOrigin: args.linkOrigin,
      liveCustomLabel: args.hub.sku,
    }));
  const live = await fetchLiveInventoryItem(args.accessToken, sku);
  if (!live) return { wrote: false };

  const offer = await findEbayOfferForSku(args.accessToken, sku);
  const offerDetails = offer?.offerId
    ? ((await fetchEbayOfferDetails(args.accessToken, offer.offerId)) ?? (offer as Record<string, unknown>))
    : null;
  const hub = hubSnapshotAsSyncItem(args.hub);
  const needs = ebayHubContentNeedsInventoryWrite(live, hub, offerDetails);
  if (!needs.title && !needs.photos && !needs.description) return { wrote: false };

  let wrote = false;
  if (needs.title || needs.photos) {
    const body = buildPassthroughLiveOverlayBody(live, {
      title: needs.title ? hub.title : undefined,
      imageUrls: needs.photos ? hub.photos : undefined,
    });
    await ebayJson(
      args.accessToken,
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      "PUT",
      body
    );
    wrote = true;
  }
  if (needs.description && offer?.offerId && offerDetails) {
    const stub = {
      ...args.item,
      title: hub.title || args.item.title,
      description: hub.description,
    } as SyncStoreItem;
    const offerBody = overlayPassthroughOffer(offerDetails, stub, {
      content: true,
      quantity: false,
      price: false,
      description: true,
    });
    await ebayJson(
      args.accessToken,
      `/sell/inventory/v1/offer/${encodeURIComponent(offer.offerId)}`,
      "PUT",
      offerBody
    );
    wrote = true;
  }
  if (wrote) {
    console.info("[ebay] Hub content copied onto Inventory/offer (skip-eBay fan-out will not do this)", {
      sku,
      title: needs.title,
      photos: needs.photos,
      description: needs.description,
      listingId: args.externalListingId,
    });
  }
  return { wrote };
}

export type { EbaySkuMap };
