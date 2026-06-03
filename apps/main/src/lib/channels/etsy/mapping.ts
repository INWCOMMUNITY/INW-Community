import type { ChannelConnectionContext, RemoteListingSummary, SyncStoreItem } from "../types";

/** Etsy taxonomy id used when a listing has no explicit mapping. Override with ETSY_DEFAULT_TAXONOMY_ID. */
function defaultTaxonomyId(): number {
  const raw = process.env.ETSY_DEFAULT_TAXONOMY_ID?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 1;
}

const VALID_WHO_MADE = new Set(["i_did", "someone_else", "collective"]);
const VALID_WHEN_MADE = new Set([
  "made_to_order",
  "2020_2025",
  "2010_2019",
  "2006_2009",
  "before_2006",
  "2000_2005",
  "1990s",
  "1980s",
  "1970s",
  "1960s",
  "1950s",
  "1940s",
  "1930s",
  "1920s",
  "1910s",
  "1900s",
  "1800s",
  "1700s",
  "before_1700",
]);

export function etsyPriceFromCents(cents: number): string {
  return (Math.max(1, Math.round(cents)) / 100).toFixed(2);
}

function etsyTitle(title: string): string {
  // Etsy titles are max 140 chars.
  return title.trim().slice(0, 140) || "Untitled";
}

function etsyDescription(item: SyncStoreItem): string {
  return (item.description?.trim() || item.title.trim() || "").slice(0, 64000);
}

/** Fields for createDraftListing (POST /shops/{shop_id}/listings). */
export function buildEtsyCreateFields(
  item: SyncStoreItem,
  conn: ChannelConnectionContext,
  overrides?: { taxonomyId?: number; shippingProfileId?: string | null }
): Record<string, string | number | boolean | undefined> {
  const whoMade = item.etsyWhoMade && VALID_WHO_MADE.has(item.etsyWhoMade) ? item.etsyWhoMade : "i_did";
  const whenMade =
    item.etsyWhenMade && VALID_WHEN_MADE.has(item.etsyWhenMade) ? item.etsyWhenMade : "made_to_order";
  const shippingId = overrides?.shippingProfileId ?? conn.etsyShippingProfileId;
  return {
    quantity: Math.max(1, item.quantity),
    title: etsyTitle(item.title),
    description: etsyDescription(item),
    price: etsyPriceFromCents(item.priceCents),
    who_made: whoMade,
    when_made: whenMade,
    taxonomy_id: overrides?.taxonomyId ?? item.etsyTaxonomyId ?? defaultTaxonomyId(),
    is_supply: item.etsyIsSupply ?? false,
    type: "physical",
    ...(shippingId ? { shipping_profile_id: Number(shippingId) } : {}),
  };
}

/** Fields for updateListing (PATCH /shops/{shop_id}/listings/{listing_id}). */
export function buildEtsyUpdateFields(
  item: SyncStoreItem,
  overrides?: { taxonomyId?: number; shippingProfileId?: string | null }
): Record<string, string | number | boolean | undefined> {
  const shippingId = overrides?.shippingProfileId;
  return {
    title: etsyTitle(item.title),
    description: etsyDescription(item),
    price: etsyPriceFromCents(item.priceCents),
    state: item.status === "active" && item.quantity > 0 ? "active" : "inactive",
    ...(item.etsyTaxonomyId || overrides?.taxonomyId
      ? { taxonomy_id: (overrides?.taxonomyId ?? item.etsyTaxonomyId) as number }
      : {}),
    ...(shippingId ? { shipping_profile_id: Number(shippingId) } : {}),
  };
}

type EtsyListing = {
  listing_id: number;
  title?: string;
  description?: string;
  quantity?: number;
  url?: string;
  taxonomy_id?: number;
  last_modified_timestamp?: number;
  price?: { amount?: number; divisor?: number } | null;
  images?: { url_fullxfull?: string; url_570xN?: string; rank?: number }[];
  skus?: string[];
};

export function etsyListingToSummary(listing: EtsyListing): RemoteListingSummary {
  const divisor = listing.price?.divisor && listing.price.divisor > 0 ? listing.price.divisor : 100;
  const amount = listing.price?.amount ?? 0;
  const priceCents = Math.round((amount / divisor) * 100);
  const photos = (listing.images ?? [])
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((img) => img.url_fullxfull || img.url_570xN || "")
    .filter(Boolean);
  return {
    externalListingId: String(listing.listing_id),
    title: listing.title?.trim() || "Untitled Etsy listing",
    description: listing.description?.trim() || null,
    priceCents: priceCents > 0 ? priceCents : 0,
    quantity: typeof listing.quantity === "number" ? listing.quantity : 0,
    photos,
    url: listing.url,
    remoteCategoryId: listing.taxonomy_id != null ? String(listing.taxonomy_id) : null,
    remoteUpdatedAt:
      listing.last_modified_timestamp != null
        ? new Date(listing.last_modified_timestamp * 1000)
        : null,
    variantsKnown: false,
    shippingKnown: false,
  };
}
