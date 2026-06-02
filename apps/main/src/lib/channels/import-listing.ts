import { prisma } from "database";
import type { ChannelProvider, RemoteListingSummary } from "./types";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function uniqueSlug(base: string): string {
  return `${base || "channel-item"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Strip HTML from Wix/Etsy descriptions for the INW listing body. */
export function plainListingDescription(description: string | null | undefined): string | null {
  if (!description?.trim()) return null;
  const text = description
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

/** Auto-post so the listing appears on the seller's storefront feed. */
function autoPostStoreItemToFeed(authorId: string, storeItemId: string): void {
  prisma.post
    .create({
      data: {
        type: "shared_store_item",
        authorId,
        sourceStoreItemId: storeItemId,
      },
    })
    .catch((err) => console.error("[channels] inbound auto-post failed", err));
}

export type ImportRemoteListingResult =
  | { ok: true; storeItemId: string; externalListingId: string }
  | { ok: false; externalListingId: string; reason: string };

/**
 * Create a StoreItem + channel link from a remote catalog row (Wix/Etsy import path).
 * Skips rows that are already linked or have invalid price.
 */
export async function importRemoteListing(args: {
  memberId: string;
  connectionId: string;
  provider: ChannelProvider;
  listing: RemoteListingSummary;
  externalShopId: string | null;
  postToFeed?: boolean;
}): Promise<ImportRemoteListingResult> {
  const { memberId, connectionId, provider, listing, externalShopId, postToFeed = true } = args;
  const productId = listing.externalListingId;
  if (!productId) {
    return { ok: false, externalListingId: "", reason: "missing_id" };
  }

  const existing = await prisma.channelListingLink.findUnique({
    where: { provider_externalListingId: { provider, externalListingId: productId } },
  });
  if (existing) {
    return { ok: false, externalListingId: productId, reason: "already_linked" };
  }
  if (listing.priceCents < 1) {
    return { ok: false, externalListingId: productId, reason: "invalid_price" };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const storeItem = await tx.storeItem.create({
        data: {
          memberId,
          title: listing.title.slice(0, 200),
          description: plainListingDescription(listing.description),
          photos: listing.photos,
          priceCents: listing.priceCents,
          quantity:
            listing.quantityKnown === false ? 1 : Math.max(0, listing.quantity),
          status:
            (listing.quantityKnown === false ? 1 : listing.quantity) > 0 ? "active" : "sold_out",
          condition: "used",
          listingType: "new",
          acceptOffers: false,
          slug: uniqueSlug(slugify(listing.title)),
        },
      });
      await tx.channelListingLink.create({
        data: {
          storeItemId: storeItem.id,
          connectionId,
          provider,
          externalListingId: productId,
          externalShopId,
          syncEnabled: true,
          syncStatus: "synced",
          lastPushedAt: new Date(),
          lastInboundAt: new Date(),
        },
      });
      return storeItem;
    });
    if (postToFeed) {
      autoPostStoreItemToFeed(memberId, created.id);
    }
    return { ok: true, storeItemId: created.id, externalListingId: productId };
  } catch (e) {
    console.error("[channels] importRemoteListing failed", {
      provider,
      externalListingId: productId,
      error: String(e),
    });
    return { ok: false, externalListingId: productId, reason: "create_failed" };
  }
}
