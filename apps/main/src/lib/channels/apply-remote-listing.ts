import { prisma } from "database";
import { deleteFeedPostsForSoldItem } from "@/lib/delete-posts-for-sold-item";
import { EBAY_TITLE_MAX } from "@/lib/listing-limits";
import { clampSaneInventoryQty } from "./inventory-sanity";
import { storeListingDescription } from "./import-listing";
import { inboundListingPhotosDiffer, selectInboundListingPhotos } from "./photo-urls";
import { ensureInwHostedListingPhotos } from "@/lib/listing-photo-rehost";
import { listingDescriptionToPlainText } from "./rich-description";
import type { ChannelProvider, RemoteListingSummary } from "./types";
import { logSyncPullQuantityChange } from "./quantity-audit";
import { skuToAdoptFromRemote } from "@/lib/listing-sku";
import { hasOptionQuantities } from "@/lib/store-item-variants";
import { isSoldOutQtyRecovery, shouldBlockSoldOutQtyRecovery } from "./sold-out-guard";

/** Normalize title text so HTML entities don't trigger false content drift. */
function normalizeTitleForCompare(title: string): string {
  return title
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

/**
 * Title or price actually changed on the channel. Ignores photos/description so
 * GetMyeBaySelling (no LastModifiedTime, no description, different photo hosts)
 * can still detect an eBay-native edit.
 */
export function remoteTitleOrPriceDiffersFromStoreItem(
  item: { title: string; priceCents: number },
  remote: Pick<RemoteListingSummary, "title" | "priceCents">
): boolean {
  const localTitle = normalizeTitleForCompare(item.title).slice(0, EBAY_TITLE_MAX);
  const remoteTitle = normalizeTitleForCompare(remote.title).slice(0, EBAY_TITLE_MAX);
  const titleDiffers = localTitle !== remoteTitle;
  const priceDiffers = remote.priceCents >= 1 && remote.priceCents !== item.priceCents;
  return titleDiffers || priceDiffers;
}

/** Compare listing bodies as plain text so HTML vs Etsy/Wix markup is not a false edit. */
export function inboundDescriptionsMatch(
  local: string | null | undefined,
  remote: string | null | undefined
): boolean {
  return (listingDescriptionToPlainText(local) ?? "") === (listingDescriptionToPlainText(remote) ?? "");
}

export function remoteContentDiffersFromStoreItem(
  item: {
    title: string;
    description: string | null;
    photos: string[];
    priceCents: number;
  },
  remote: RemoteListingSummary
): boolean {
  const localTitle = normalizeTitleForCompare(item.title).slice(0, EBAY_TITLE_MAX);
  const remoteTitle = normalizeTitleForCompare(remote.title).slice(0, EBAY_TITLE_MAX);
  return (
    localTitle !== remoteTitle ||
    item.priceCents !== remote.priceCents ||
    inboundListingPhotosDiffer(item.photos, remote.photos) ||
    !inboundDescriptionsMatch(item.description, remote.description)
  );
}

/** Apply Best Offer on/off + minimum from a channel snapshot. */
export async function applyRemoteBestOfferToStoreItem(
  storeItemId: string,
  remote: Pick<RemoteListingSummary, "acceptOffers" | "minOfferCents" | "acceptOffersKnown">
): Promise<boolean> {
  if (remote.acceptOffersKnown !== true) return false;
  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { acceptOffers: true, minOfferCents: true },
  });
  if (!item) return false;
  const remoteAccept = remote.acceptOffers ?? false;
  const remoteMin = remote.minOfferCents ?? null;
  if (item.acceptOffers === remoteAccept && item.minOfferCents === remoteMin) return false;
  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: { acceptOffers: remoteAccept, minOfferCents: remoteMin },
  });
  return true;
}

/** Apply title, price, photos, description from a channel catalog snapshot (not quantity). */
export async function applyRemoteContentToStoreItem(
  storeItemId: string,
  remote: RemoteListingSummary
): Promise<boolean> {
  const item = await prisma.storeItem.findUnique({ where: { id: storeItemId } });
  if (!item) {
    console.log("[channels] applyRemoteContent: item not found", { storeItemId });
    return false;
  }
  if (item.status === "sold_out" && item.quantity === 0) {
    console.log("[channels] applyRemoteContent: skipped sold out item", { storeItemId });
    return false;
  }

  // Never overwrite a valid local price with a zero from a bad remote read (e.g. after a bad sync).
  const safeRemote: RemoteListingSummary =
    remote.priceCents < 1 && item.priceCents > 0 ? { ...remote, priceCents: item.priceCents } : remote;

  const inboundPhotos = selectInboundListingPhotos(item.photos, safeRemote.photos);
  const selectedPhotos =
    inboundPhotos.length > 0 || item.photos.length === 0 ? inboundPhotos : item.photos;
  const photosToWrite = await ensureInwHostedListingPhotos(selectedPhotos);
  const hostedPhotosChanged =
    photosToWrite.length !== item.photos.length ||
    photosToWrite.some((url, i) => url !== item.photos[i]);

  // A per-option listing prices each SKU independently. The channel's listing-level
  // price is the *lowest* variation price, so applying it standalone would collapse
  // every INW variation to that price. Only adopt the listing price when the remote is
  // variants-hydrated this tick (per-SKU prices are applied alongside via
  // applyRemoteVariantsToStoreItem); otherwise keep INW's price until hydration.
  const inwIsPerOption = hasOptionQuantities(item.variants);
  const applyPrice = shouldApplyRemoteListingPrice(item.variants, safeRemote.variantsKnown);

  const nonPriceDiffers =
    normalizeTitleForCompare(item.title).slice(0, EBAY_TITLE_MAX) !==
      normalizeTitleForCompare(safeRemote.title).slice(0, EBAY_TITLE_MAX) ||
    inboundListingPhotosDiffer(item.photos, safeRemote.photos) ||
    !inboundDescriptionsMatch(item.description, safeRemote.description);
  const differs = applyPrice
    ? remoteContentDiffersFromStoreItem(item, safeRemote)
    : nonPriceDiffers;
  const adoptedSku = skuToAdoptFromRemote({
    localSku: item.sku,
    remoteSku: safeRemote.sku,
    itemId: storeItemId,
  });
  if (!differs && !adoptedSku && !hostedPhotosChanged) {
    console.log("[channels] applyRemoteContent: no differences detected", {
      storeItemId,
      localTitle: item.title?.slice(0, 30),
      remoteTitle: safeRemote.title?.slice(0, 30),
      localPrice: item.priceCents,
      remotePrice: safeRemote.priceCents,
      localPhotos: item.photos?.length,
      remotePhotos: safeRemote.photos?.length,
      inwIsPerOption,
      applyPrice,
    });
    return false;
  }

  console.log("[channels] applyRemoteContent: applying changes", {
    storeItemId,
    titleChanged: item.title !== safeRemote.title.slice(0, 200),
    priceChanged: applyPrice && item.priceCents !== safeRemote.priceCents,
    priceHeldForVariants: inwIsPerOption && !applyPrice && item.priceCents !== safeRemote.priceCents,
    photosChanged: inboundListingPhotosDiffer(item.photos, safeRemote.photos),
    oldPrice: item.priceCents,
    newPrice: safeRemote.priceCents,
  });

  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: {
      ...(differs
        ? {
            title: safeRemote.title.slice(0, 200),
            description: storeListingDescription(safeRemote.description),
            photos: photosToWrite,
            ...(applyPrice ? { priceCents: safeRemote.priceCents } : {}),
          }
        : hostedPhotosChanged
          ? { photos: photosToWrite }
          : {}),
      ...(adoptedSku ? { sku: adoptedSku } : {}),
    },
  });
  return true;
}

/** Apply quantity from Wix inventory webhooks or targeted pull (not catalog list defaults). */
export function shouldApplyAggregateRemoteQuantity(
  variants: unknown,
  remoteVariantsKnown?: boolean
): boolean {
  if (!hasOptionQuantities(variants)) return true;
  return remoteVariantsKnown === true;
}

/**
 * A channel's listing-level price for a per-option item is the *lowest* variation price.
 * Adopting it standalone collapses every INW variation to that price. Only apply the
 * listing-level price when the remote is variants-hydrated this tick, so per-SKU prices
 * are applied alongside (via applyRemoteVariantsToStoreItem). Simple (non-variant)
 * listings always adopt the remote price.
 */
export function shouldApplyRemoteListingPrice(
  variants: unknown,
  remoteVariantsKnown?: boolean
): boolean {
  if (!hasOptionQuantities(variants)) return true;
  return remoteVariantsKnown === true;
}

export async function applyRemoteQuantityToStoreItem(
  storeItemId: string,
  remoteQuantity: number,
  auditContext?: {
    provider: ChannelProvider;
    memberId: string;
    externalEventId?: string;
  }
): Promise<boolean> {
  const item = await prisma.storeItem.findUnique({ where: { id: storeItemId } });
  if (!item) return false;

  if (!shouldApplyAggregateRemoteQuantity(item.variants)) {
    console.log("[channels] skip aggregate qty pull; listing uses per-option stock", {
      storeItemId,
      remoteQuantity,
    });
    return false;
  }

  const remoteQty = clampSaneInventoryQty(remoteQuantity);
  if (remoteQty == null) {
    console.warn("[channels] rejected absurd inbound quantity", { storeItemId, remoteQuantity });
    return false;
  }
  if (item.quantity === remoteQty) return false;

  if (isSoldOutQtyRecovery(item.quantity, item.status, remoteQty)) {
    if (await shouldBlockSoldOutQtyRecovery(storeItemId)) {
      console.log("[channels] skipping qty recovery on sold-out item", {
        storeItemId,
        remoteQty,
        inwQty: item.quantity,
        status: item.status,
      });
      return false;
    }
  }

  const previousQty = item.quantity;
  const nextStatus =
    remoteQty > 0
      ? item.status === "sold_out" || item.status === "active"
        ? "active"
        : item.status
      : "sold_out";

  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: { quantity: remoteQty, status: nextStatus },
  });

  // Log the quantity change for audit trail
  if (auditContext) {
    logSyncPullQuantityChange({
      storeItemId,
      memberId: auditContext.memberId,
      provider: auditContext.provider,
      previousQty,
      newQty: remoteQty,
      externalEventId: auditContext.externalEventId,
    });
  }

  if (remoteQty === 0) {
    deleteFeedPostsForSoldItem(storeItemId).catch(() => {});
  }
  return true;
}

/**
 * Pull channel stock onto INW. Variation listings must write option rows, not a single total.
 */
export async function applyRemoteStockFromChannel(
  storeItemId: string,
  remote: RemoteListingSummary,
  auditContext: {
    provider: ChannelProvider;
    memberId: string;
    externalEventId?: string;
  }
): Promise<boolean> {
  if (remote.variantsKnown && remote.variants) {
    const { applyRemoteVariantsToStoreItem } = await import("./apply-remote-meta");
    const vars = await applyRemoteVariantsToStoreItem(storeItemId, remote, auditContext.provider);
    if (vars) return true;
  }
  if (remote.quantityKnown === false) return false;
  return applyRemoteQuantityToStoreItem(storeItemId, remote.quantity, auditContext);
}

/** @deprecated Prefer applyRemoteContentToStoreItem + applyRemoteQuantityToStoreItem */
export async function applyRemoteListingToStoreItem(
  storeItemId: string,
  remote: RemoteListingSummary
): Promise<{ contentChanged: boolean; quantityChanged: boolean }> {
  const contentChanged = await applyRemoteContentToStoreItem(storeItemId, remote);
  let quantityChanged = false;
  if (remote.quantityKnown !== false) {
    quantityChanged = await applyRemoteQuantityToStoreItem(storeItemId, remote.quantity);
  }
  return { contentChanged, quantityChanged };
}

/** Wix product removed — mark INW listing sold out and zero pooled inventory. */
export async function applyRemoteListingRemoved(storeItemId: string): Promise<boolean> {
  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { quantity: true, status: true },
  });
  if (!item) return false;
  if (item.quantity === 0 && item.status === "sold_out") return false;

  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: { quantity: 0, status: "sold_out" },
  });
  deleteFeedPostsForSoldItem(storeItemId).catch(() => {});
  return true;
}
