import type { ChannelConnectionContext, RemoteListingSummary, SyncStoreItem } from "../types";
import { listingDescriptionToPlainText } from "../rich-description";

/**
 * Map of common Etsy top-level taxonomy IDs to category names.
 * These are the main categories from Etsy's seller taxonomy.
 * Source: Etsy Open API /application/seller-taxonomy/nodes
 */
const ETSY_TAXONOMY_NAMES: Record<number, string> = {
  // Top-level categories
  1: "Art & Collectibles",
  77: "Accessories",
  78: "Bags & Purses",
  79: "Bath & Beauty",
  80: "Books, Films & Music",
  81: "Clothing",
  82: "Craft Supplies & Tools",
  83: "Electronics & Accessories",
  84: "Home & Living",
  85: "Jewelry",
  86: "Paper & Party Supplies",
  87: "Pet Supplies",
  88: "Shoes",
  89: "Toys & Games",
  90: "Weddings",
  
  // Art & Collectibles subcategories
  18: "Photography",
  19: "Painting",
  21: "Prints",
  23: "Sculpture",
  24: "Drawing & Illustration",
  25: "Mixed Media & Collage",
  26: "Fiber Arts",
  27: "Glass Art",
  28: "Collectibles",
  29: "Dolls & Miniatures",
  
  // Accessories subcategories
  262: "Hats & Caps",
  264: "Scarves & Wraps",
  265: "Belts & Suspenders",
  266: "Sunglasses & Eyewear",
  267: "Gloves & Mittens",
  268: "Hair Accessories",
  
  // Jewelry subcategories
  481: "Bracelets",
  483: "Earrings",
  485: "Necklaces",
  487: "Rings",
  489: "Body Jewelry",
  491: "Watches",
  
  // Home & Living subcategories
  428: "Bedding",
  429: "Bathroom",
  430: "Kitchen & Dining",
  431: "Lighting",
  432: "Outdoor & Garden",
  433: "Rugs",
  434: "Storage & Organization",
  435: "Furniture",
  441: "Home Decor",
  
  // Clothing subcategories
  361: "Dresses",
  362: "Tops & Tees",
  363: "Pants & Capris",
  364: "Skirts",
  365: "Sweaters",
  366: "Jackets & Coats",
  367: "Suits & Blazers",
  368: "Shorts",
  369: "Swimwear",
  
  // Bath & Beauty subcategories
  375: "Skin Care",
  376: "Soaps",
  377: "Hair Care",
  378: "Makeup & Cosmetics",
  379: "Fragrances",
  
  // Paper & Party Supplies subcategories
  524: "Party Supplies",
  525: "Invitations & Announcements",
  526: "Greeting Cards",
  527: "Calendars & Planners",
  528: "Stickers, Labels & Tags",
  529: "Gift Wrapping",
  
  // Bags & Purses subcategories
  301: "Backpacks",
  302: "Handbags",
  303: "Clutches & Evening Bags",
  304: "Messenger Bags",
  305: "Wallets & Money Clips",
  306: "Totes",
  
  // Craft Supplies subcategories
  331: "Fabric",
  332: "Beads",
  333: "Sewing & Needlecraft",
  334: "Yarn & Fiber",
  335: "Jewelry Making",
  336: "Paper, Party & Kids",
  
  // Toys & Games subcategories
  580: "Dolls & Action Figures",
  581: "Games & Puzzles",
  582: "Sports & Outdoor",
  583: "Stuffed Animals & Plushies",
  
  // Pet Supplies subcategories
  551: "Pet Collars & Leashes",
  552: "Pet Furniture",
  553: "Pet Clothing",
  554: "Pet Toys",
  555: "Pet Beds",
  
  // Shoes subcategories
  561: "Women's Shoes",
  562: "Men's Shoes",
  563: "Unisex Shoes",
  564: "Children's Shoes",
  
  // Weddings subcategories
  591: "Accessories",
  592: "Clothing",
  593: "Decorations",
  594: "Gifts & Mementos",
  595: "Invitations & Paper",
};

/** Get human-readable category name from Etsy taxonomy ID. */
export function getEtsyTaxonomyName(taxonomyId: number | null | undefined): string | null {
  if (taxonomyId == null) return null;
  
  // Direct match
  if (ETSY_TAXONOMY_NAMES[taxonomyId]) {
    return ETSY_TAXONOMY_NAMES[taxonomyId];
  }
  
  // Try to find parent category (taxonomy IDs are hierarchical)
  // Etsy uses ID ranges: top-level < 100, sub-levels > 100
  // For unknown IDs, we'll return null and let the category resolver handle it
  return null;
}

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
  // Etsy listing description is plain text; keep line breaks from our HTML subset.
  const plain =
    listingDescriptionToPlainText(item.description) ||
    item.description?.trim() ||
    item.title.trim() ||
    "";
  return plain.slice(0, 64000);
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
  const whoMade = item.etsyWhoMade && VALID_WHO_MADE.has(item.etsyWhoMade) ? item.etsyWhoMade : undefined;
  const whenMade = item.etsyWhenMade && VALID_WHEN_MADE.has(item.etsyWhenMade) ? item.etsyWhenMade : undefined;
  return {
    title: etsyTitle(item.title),
    description: etsyDescription(item),
    price: etsyPriceFromCents(item.priceCents),
    state: item.status === "active" && item.quantity > 0 ? "active" : "inactive",
    ...(item.etsyTaxonomyId || overrides?.taxonomyId
      ? { taxonomy_id: (overrides?.taxonomyId ?? item.etsyTaxonomyId) as number }
      : {}),
    ...(shippingId ? { shipping_profile_id: Number(shippingId) } : {}),
    // Include who_made and when_made if set (so edits sync these fields)
    ...(whoMade ? { who_made: whoMade } : {}),
    ...(whenMade ? { when_made: whenMade } : {}),
    // is_supply can also be updated
    ...(item.etsyIsSupply != null ? { is_supply: item.etsyIsSupply } : {}),
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
  
  // Resolve category name from taxonomy ID for auto-mapping
  const categoryName = getEtsyTaxonomyName(listing.taxonomy_id);
  
  // Take the first SKU if the listing has any
  const firstSku = listing.skus?.[0]?.trim() || null;

  return {
    externalListingId: String(listing.listing_id),
    title: listing.title?.trim() || "Untitled Etsy listing",
    sku: firstSku,
    description: listing.description?.trim() || null,
    priceCents: priceCents > 0 ? priceCents : 0,
    quantity: typeof listing.quantity === "number" ? listing.quantity : 0,
    quantityKnown: typeof listing.quantity === "number",
    photos,
    url: listing.url,
    category: categoryName,
    remoteCategoryId: listing.taxonomy_id != null ? String(listing.taxonomy_id) : null,
    remoteUpdatedAt:
      listing.last_modified_timestamp != null
        ? new Date(listing.last_modified_timestamp * 1000)
        : null,
    variantsKnown: false,
    shippingKnown: false,
  };
}
