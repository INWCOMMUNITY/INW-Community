import { prisma } from "database";
import { deleteFeedPostsForSoldItem } from "@/lib/delete-posts-for-sold-item";
import { plainListingDescription } from "./import-listing";
import type { RemoteListingSummary } from "./types";

function photosEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((url, i) => url === b[i]);
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
    item.title !== remote.title.slice(0, 200) ||
    item.priceCents !== remote.priceCents ||
    !photosEqual(item.photos, remote.photos) ||
    (plainListingDescription(item.description) ?? "") !==
      (plainListingDescription(remote.description) ?? "")
  );
}

/** Apply title, price, photos, description from a channel catalog snapshot (not quantity). */
export async function applyRemoteContentToStoreItem(
  storeItemId: string,
  remote: RemoteListingSummary
): Promise<boolean> {
  const item = await prisma.storeItem.findUnique({ where: { id: storeItemId } });
  if (!item) return false;
  if (item.status === "sold_out" && item.quantity === 0) return false;
  if (!remoteContentDiffersFromStoreItem(item, remote)) return false;

  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: {
      title: remote.title.slice(0, 200),
      description: plainListingDescription(remote.description),
      photos: remote.photos,
      priceCents: remote.priceCents,
    },
  });
  return true;
}

/** Apply quantity from Wix inventory webhooks or targeted pull (not catalog list defaults). */
export async function applyRemoteQuantityToStoreItem(
  storeItemId: string,
  remoteQuantity: number
): Promise<boolean> {
  const item = await prisma.storeItem.findUnique({ where: { id: storeItemId } });
  if (!item) return false;
  if (item.status === "sold_out" && item.quantity === 0 && remoteQuantity > 0) {
    return false;
  }

  const remoteQty = Math.max(0, remoteQuantity);
  if (item.quantity === remoteQty) return false;

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
export async function applyRemoteListingRemoved(storeItemId: string): Promise<void> {
  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { quantity: true, status: true },
  });
  if (!item) return;
  if (item.quantity === 0 && item.status === "sold_out") return;

  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: { quantity: 0, status: "sold_out" },
  });
  deleteFeedPostsForSoldItem(storeItemId).catch(() => {});
}
