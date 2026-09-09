export type EbayOfferLike = {
  offerId?: string;
  status?: string;
  listing?: { listingId?: string | number | null } | null;
  listingId?: string | number | null;
};

export function ebayOfferIsPublished(status: string | null | undefined): boolean {
  return (status ?? "").toUpperCase() === "PUBLISHED";
}

/** Prefer the live offer when eBay returns unpublished leftovers for the same SKU. */
export function pickEbayOffer<T extends { status?: string }>(offers: T[] | undefined | null): T | null {
  if (!offers?.length) return null;
  return offers.find((offer) => ebayOfferIsPublished(offer.status)) ?? offers[0] ?? null;
}

export function readEbayOfferListingId(offer: EbayOfferLike | null | undefined): string | null {
  if (!offer) return null;
  const raw = offer.listing?.listingId ?? offer.listingId;
  if (raw == null) return null;
  const id = String(raw).trim();
  return /^\d+$/.test(id) ? id : null;
}

/**
 * Inventory PUT revises a live listing. POST /offer/{id}/publish on an unpublished
 * leftover creates a second Item ID while the old Trading listing can stay active.
 */
export function shouldPublishEbayOffer(args: {
  canPublish: boolean;
  itemIsActive: boolean;
  quantity: number;
  offerId: string | null | undefined;
  offerStatus?: string | null;
}): boolean {
  if (!args.canPublish || !args.itemIsActive || args.quantity <= 0 || !args.offerId) return false;
  return !ebayOfferIsPublished(args.offerStatus);
}

/**
 * Content updates (Etsy title fan-out, INW edits) must never EndItem + republish.
 * That path ended the live Trading listing and marked it deleted in Needs Attention
 * while the same item was still for sale on eBay.
 */
export function shouldRepublishEbayOffer(args: {
  operation: "create" | "update";
  canPublish: boolean;
  itemIsActive: boolean;
  quantity: number;
  offerId: string | null | undefined;
  offerStatus?: string | null;
}): boolean {
  if (args.operation === "update") return false;
  return shouldPublishEbayOffer(args);
}

/**
 * Variation groups use publish_by_group. That creates a new Item ID when Inventory
 * has no offer for the parent SKU — even if INW already linked a live listing.
 * Content updates must never take that path.
 */
export function shouldPublishEbayInventoryGroup(args: {
  operation: "create" | "update";
  canPublish: boolean;
  itemIsActive: boolean;
  inStock: boolean;
  hadOfferAtStart: boolean;
  /** Live Trading Item ID on the channel link, even when findOffer(parentSku) misses. */
  listingAlreadyLinked?: boolean;
}): boolean {
  if (args.operation === "update") return false;
  if (args.listingAlreadyLinked) return false;
  return args.canPublish && args.itemIsActive && args.inStock && !args.hadOfferAtStart;
}

/** Inventory PUT at qty 0 fails #25004 on unpublished / draft offers and then blocks title. */
export function shouldSkipEbayInventoryContentPutAtZeroQty(quantity: number): boolean {
  return quantity <= 0;
}

/** Unpublished offers reject quantity 0 (#25004) and then block inventory Brand updates. */
export function shouldWriteEbayOffer(args: {
  quantity: number;
  offerId: string | null | undefined;
  offerStatus?: string | null;
}): boolean {
  if (args.quantity > 0) return true;
  return Boolean(args.offerId) && ebayOfferIsPublished(args.offerStatus);
}

export function shouldDeleteUnpublishedZeroQuantityOffer(args: {
  quantity: number;
  offerId: string | null | undefined;
  offerStatus?: string | null;
}): boolean {
  return args.quantity <= 0 && Boolean(args.offerId) && !ebayOfferIsPublished(args.offerStatus);
}
