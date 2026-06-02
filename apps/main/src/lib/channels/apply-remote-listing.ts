import { prisma } from "database";
import { deleteFeedPostsForSoldItem } from "@/lib/delete-posts-for-sold-item";
import { plainListingDescription } from "./import-listing";
import type { RemoteListingSummary } from "./types";

function photosEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((url, i) => url === b[i]);
}

export function remoteListingDiffersFromStoreItem(
  item: {
    title: string;
    description: string | null;
    photos: string[];
    priceCents: number;
    quantity: number;
  },
  remote: RemoteListingSummary
): { content: boolean; quantity: boolean } {
  const remoteQty = Math.max(0, remote.quantity);
  const content =
    item.title !== remote.title.slice(0, 200) ||
    item.priceCents !== remote.priceCents ||
    !photosEqual(item.photos, remote.photos) ||
    (plainListingDescription(item.description) ?? "") !==
      (plainListingDescription(remote.description) ?? "");
  return { content, quantity: item.quantity !== remoteQty };
}

/**
 * Apply a Wix (or other channel) catalog snapshot onto the linked StoreItem.
 * Returns whether content and/or quantity changed.
 */
export async function applyRemoteListingToStoreItem(
  storeItemId: string,
  remote: RemoteListingSummary
): Promise<{ contentChanged: boolean; quantityChanged: boolean }> {
  const item = await prisma.storeItem.findUnique({ where: { id: storeItemId } });
  if (!item) return { contentChanged: false, quantityChanged: false };

  // Sold-out / zero stock on INW is authoritative — do not resurrect from channel catalog sync.
  if (item.status === "sold_out" && item.quantity === 0) {
    return { contentChanged: false, quantityChanged: false };
  }

  const { content, quantity } = remoteListingDiffersFromStoreItem(item, remote);
  if (!content && !quantity) return { contentChanged: false, quantityChanged: false };

  const remoteQty = Math.max(0, remote.quantity);
  const nextStatus =
    remoteQty > 0
      ? item.status === "sold_out" || item.status === "active"
        ? "active"
        : item.status
      : "sold_out";

  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: {
      ...(content
        ? {
            title: remote.title.slice(0, 200),
            description: plainListingDescription(remote.description),
            photos: remote.photos,
            priceCents: remote.priceCents,
          }
        : {}),
      ...(quantity
        ? {
            quantity: remoteQty,
            status: nextStatus,
          }
        : {}),
    },
  });

  if (remoteQty === 0) {
    deleteFeedPostsForSoldItem(storeItemId).catch(() => {});
  }

  return { contentChanged: content, quantityChanged: quantity };
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
