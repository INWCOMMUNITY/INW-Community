import { prisma } from "database";
import { deleteFeedPostsForSoldItem } from "@/lib/delete-posts-for-sold-item";
import { EBAY_TITLE_MAX } from "@/lib/listing-limits";
import { clampSaneInventoryQty } from "./inventory-sanity";
import { storeListingDescription } from "./import-listing";
import { sanitizeListingDescription } from "./rich-description";
import type { ChannelProvider, RemoteListingSummary } from "./types";
import { logSyncPullQuantityChange } from "./quantity-audit";

function photosEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((url, i) => url === b[i]);
}

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

export function remoteContentDiffersFromStoreItem(
  item: {
    title: string;
    description: string | null;
    photos: string[];
    priceCents: number;
  },
  remote: RemoteListingSummary
): boolean {
  return (
    normalizeTitleForCompare(item.title) !== normalizeTitleForCompare(remote.title.slice(0, 200)) ||
    item.priceCents !== remote.priceCents ||
    !photosEqual(item.photos, remote.photos) ||
    (sanitizeListingDescription(item.description) ?? "") !==
      (sanitizeListingDescription(remote.description) ?? "")
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

  const differs = remoteContentDiffersFromStoreItem(item, safeRemote);
  if (!differs) {
    console.log("[channels] applyRemoteContent: no differences detected", {
      storeItemId,
      localTitle: item.title?.slice(0, 30),
      remoteTitle: safeRemote.title?.slice(0, 30),
      localPrice: item.priceCents,
      remotePrice: safeRemote.priceCents,
      localPhotos: item.photos?.length,
      remotePhotos: safeRemote.photos?.length,
    });
    return false;
  }

  console.log("[channels] applyRemoteContent: applying changes", {
    storeItemId,
    titleChanged: item.title !== safeRemote.title.slice(0, 200),
    priceChanged: item.priceCents !== safeRemote.priceCents,
    photosChanged: !photosEqual(item.photos, safeRemote.photos),
    oldPrice: item.priceCents,
    newPrice: safeRemote.priceCents,
  });

  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: {
      title: safeRemote.title.slice(0, 200),
      description: storeListingDescription(safeRemote.description),
      photos: safeRemote.photos,
      priceCents: safeRemote.priceCents,
    },
  });
  return true;
}

/** Apply quantity from Wix inventory webhooks or targeted pull (not catalog list defaults). */
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

  const remoteQty = clampSaneInventoryQty(remoteQuantity);
  if (remoteQty == null) {
    console.warn("[channels] rejected absurd inbound quantity", { storeItemId, remoteQuantity });
    return false;
  }
  if (item.quantity === remoteQty) return false;

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
