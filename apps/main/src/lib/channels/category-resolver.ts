import { STORE_CATEGORIES } from "@/lib/store-categories";
import type { ChannelProvider } from "./types";
import {
  EBAY_CATEGORY_ALIASES,
  ebayCategoryPathCandidates,
  splitEbayCategoryPath,
} from "./ebay-category-aliases";

/** Minimum similarity score (0–1) to map a remote label to a preset INW category (strict mode). */
export const CATEGORY_MATCH_THRESHOLD = 0.72;

/**
 * Floor for "closest preset" mode used by Etsy/Wix sync — always pick the best INW
 * preset above this score instead of storing a raw marketplace label.
 */
export const CLOSEST_PRESET_FLOOR = 0.28;

type AliasHit = { category: string; subcategory: string | null };

/**
 * Etsy seller-taxonomy top-levels + common mid/leaf labels → closest INW preset.
 * Covers all 15 Etsy top-level categories from seller help.
 */
const ETSY_CATEGORY_ALIASES: Record<string, AliasHit> = {
  // Top-level
  accessories: { category: "Accessories", subcategory: null },
  "art & collectibles": { category: "Art & Collectibles", subcategory: null },
  "art and collectibles": { category: "Art & Collectibles", subcategory: null },
  "bags & purses": { category: "Bags & Purses", subcategory: null },
  "bags and purses": { category: "Bags & Purses", subcategory: null },
  "bath & beauty": { category: "Bath & Beauty", subcategory: null },
  "bath and beauty": { category: "Bath & Beauty", subcategory: null },
  "books, movies & music": { category: "Books, Movies & Music", subcategory: null },
  "books movies & music": { category: "Books, Movies & Music", subcategory: null },
  "books, films & music": { category: "Books, Movies & Music", subcategory: null },
  "books films & music": { category: "Books, Movies & Music", subcategory: null },
  clothing: { category: "Clothing", subcategory: null },
  "craft supplies & tools": { category: "Craft Supplies & Tools", subcategory: null },
  "craft supplies and tools": { category: "Craft Supplies & Tools", subcategory: null },
  "electronics & accessories": { category: "Electronics & Accessories", subcategory: null },
  "electronics and accessories": { category: "Electronics & Accessories", subcategory: null },
  "home & living": { category: "Home & Living", subcategory: null },
  "home and living": { category: "Home & Living", subcategory: null },
  jewelry: { category: "Jewelry & Watches", subcategory: null },
  jewellery: { category: "Jewelry & Watches", subcategory: null },
  "paper & party supplies": { category: "Paper & Party Supplies", subcategory: null },
  "paper and party supplies": { category: "Paper & Party Supplies", subcategory: null },
  "pet supplies": { category: "Pet Supplies", subcategory: null },
  shoes: { category: "Shoes", subcategory: null },
  "toys & games": { category: "Toys & Games", subcategory: null },
  "toys and games": { category: "Toys & Games", subcategory: null },
  weddings: { category: "Wedding", subcategory: null },
  wedding: { category: "Wedding", subcategory: null },

  // Accessories mid-level
  "hats & head coverings": { category: "Accessories", subcategory: "Hats & Caps" },
  "hats & caps": { category: "Accessories", subcategory: "Hats & Caps" },
  "scarves & wraps": { category: "Accessories", subcategory: "Scarves & Wraps" },
  "belts & suspenders": { category: "Accessories", subcategory: "Belts" },
  "sunglasses & eyewear": { category: "Accessories", subcategory: "Sunglasses & Eyewear" },
  "gloves & sleeves": { category: "Accessories", subcategory: "Gloves & Mittens" },
  "hair accessories": { category: "Accessories", subcategory: "Hair Accessories" },
  "keychains & lanyards": { category: "Accessories", subcategory: "Keychains & Lanyards" },
  "pins & clips": { category: "Accessories", subcategory: "Pins & Badges" },
  "suit & tie accessories": { category: "Accessories", subcategory: "Ties & Pocket Squares" },
  "costume accessories": { category: "Accessories", subcategory: "Costume Accessories" },

  // Art & Collectibles mid-level
  "drawing & illustration": { category: "Art & Collectibles", subcategory: "Drawing & Illustration" },
  "fiber arts": { category: "Art & Collectibles", subcategory: "Fiber Arts" },
  "glass art": { category: "Art & Collectibles", subcategory: "Glass Art" },
  "dolls & miniatures": { category: "Art & Collectibles", subcategory: "Dolls & Miniatures" },
  photography: { category: "Art & Collectibles", subcategory: "Photography" },
  painting: { category: "Art & Collectibles", subcategory: "Paintings & Prints" },
  "prints": { category: "Art & Collectibles", subcategory: "Paintings & Prints" },
  sculpture: { category: "Art & Collectibles", subcategory: "Sculpture & Statues" },
  memorabilia: { category: "Art & Collectibles", subcategory: "Memorabilia" },
  collectibles: { category: "Art & Collectibles", subcategory: null },

  // Bags
  handbags: { category: "Bags & Purses", subcategory: "Handbags" },
  backpacks: { category: "Bags & Purses", subcategory: "Backpacks" },
  "wallets & money clips": { category: "Bags & Purses", subcategory: "Wallets & Card Holders" },
  totes: { category: "Bags & Purses", subcategory: "Totes & Shopping Bags" },

  // Bath & Beauty
  "skin care": { category: "Bath & Beauty", subcategory: "Skin Care" },
  "hair care": { category: "Bath & Beauty", subcategory: "Hair Care" },
  makeup: { category: "Bath & Beauty", subcategory: "Makeup & Cosmetics" },
  fragrance: { category: "Bath & Beauty", subcategory: "Fragrances" },
  "soaps & bath bombs": { category: "Bath & Beauty", subcategory: "Soaps & Bath" },
  soap: { category: "Bath & Beauty", subcategory: "Soaps & Bath" },

  // Home & Living mid-level
  "home decor": { category: "Home & Living", subcategory: "Home Decor" },
  "wall decor": { category: "Home & Living", subcategory: "Wall Decor" },
  bedding: { category: "Home & Living", subcategory: "Bedding" },
  bathroom: { category: "Home & Living", subcategory: "Bathroom" },
  lighting: { category: "Home & Living", subcategory: "Lighting" },
  "storage & organization": { category: "Home & Living", subcategory: "Home Storage" },
  kitchen: { category: "Home & Kitchen", subcategory: null },
  "dining & serving": { category: "Home & Kitchen", subcategory: "Dining & Serving" },
  furniture: { category: "Furniture", subcategory: null },
  gardening: { category: "Home & Garden", subcategory: "Outdoor & Gardening" },

  // Jewelry
  necklaces: { category: "Jewelry & Watches", subcategory: "Necklaces & Pendants" },
  bracelets: { category: "Jewelry & Watches", subcategory: "Bracelets" },
  earrings: { category: "Jewelry & Watches", subcategory: "Earrings" },
  rings: { category: "Jewelry & Watches", subcategory: "Rings" },
  "body jewelry": { category: "Jewelry & Watches", subcategory: "Body Jewelry" },
  watches: { category: "Jewelry & Watches", subcategory: "Watches" },

  // Paper & Party
  "greeting cards": { category: "Paper & Party Supplies", subcategory: "Greeting Cards" },
  invitations: { category: "Paper & Party Supplies", subcategory: "Invitations" },
  "party decorations": { category: "Paper & Party Supplies", subcategory: "Party Decorations" },
  "gift wrapping": { category: "Paper & Party Supplies", subcategory: "Gift Wrap & Packaging" },
  stickers: { category: "Paper & Party Supplies", subcategory: "Stickers & Labels" },

  // Pets / Shoes / Toys / Wedding
  "dog supplies": { category: "Pet Supplies", subcategory: "Dog" },
  "cat supplies": { category: "Pet Supplies", subcategory: "Cat" },
  "women's shoes": { category: "Shoes", subcategory: "Women's Shoes" },
  "mens shoes": { category: "Shoes", subcategory: "Men's Shoes" },
  "men's shoes": { category: "Shoes", subcategory: "Men's Shoes" },
  "board games": { category: "Toys & Games", subcategory: "Board Games & Puzzles" },
  "stuffed animals": { category: "Toys & Games", subcategory: "Dolls & Stuffed Animals" },
  "bridal accessories": { category: "Wedding", subcategory: "Accessories" },
  "wedding decorations": { category: "Wedding", subcategory: "Decor & Centerpieces" },

  // Additional Etsy taxonomy mappings (expanded coverage)
  // Clothing mid-level
  "women's clothing": { category: "Clothing", subcategory: "Women's Clothing" },
  "womens clothing": { category: "Clothing", subcategory: "Women's Clothing" },
  "men's clothing": { category: "Clothing", subcategory: "Men's Clothing" },
  "mens clothing": { category: "Clothing", subcategory: "Men's Clothing" },
  dresses: { category: "Clothing", subcategory: "Dresses" },
  dress: { category: "Clothing", subcategory: "Dresses" },
  tops: { category: "Clothing", subcategory: "Tops & Tees" },
  "tops & tees": { category: "Clothing", subcategory: "Tops & Tees" },
  shirts: { category: "Clothing", subcategory: "Tops & Tees" },
  "t-shirts": { category: "Clothing", subcategory: "Tops & Tees" },
  sweaters: { category: "Clothing", subcategory: "Sweaters" },
  hoodies: { category: "Clothing", subcategory: "Hoodies & Sweatshirts" },
  "hoodies & sweatshirts": { category: "Clothing", subcategory: "Hoodies & Sweatshirts" },
  jackets: { category: "Clothing", subcategory: "Jackets & Coats" },
  "jackets & coats": { category: "Clothing", subcategory: "Jackets & Coats" },
  coats: { category: "Clothing", subcategory: "Jackets & Coats" },
  pants: { category: "Clothing", subcategory: "Pants" },
  "pants & capris": { category: "Clothing", subcategory: "Pants" },
  jeans: { category: "Clothing", subcategory: "Jeans" },
  shorts: { category: "Clothing", subcategory: "Shorts" },
  skirts: { category: "Clothing", subcategory: "Skirts" },
  swimwear: { category: "Clothing", subcategory: "Swimwear" },
  "suits & blazers": { category: "Clothing", subcategory: "Suits & Blazers" },
  activewear: { category: "Clothing", subcategory: "Activewear" },
  sleepwear: { category: "Clothing", subcategory: "Sleepwear" },
  costumes: { category: "Clothing", subcategory: "Costumes" },
  vintage: { category: "Art & Collectibles", subcategory: "Vintage & Antiques" },

  // Art & Collectibles expanded
  art: { category: "Art & Collectibles", subcategory: null },
  "fine art": { category: "Art & Collectibles", subcategory: "Paintings & Prints" },
  "mixed media": { category: "Art & Collectibles", subcategory: "Mixed Media & Collage" },
  "mixed media & collage": { category: "Art & Collectibles", subcategory: "Mixed Media & Collage" },
  collage: { category: "Art & Collectibles", subcategory: "Mixed Media & Collage" },
  "artist trading cards": { category: "Art & Collectibles", subcategory: "Drawing & Illustration" },

  // Craft Supplies expanded
  beads: { category: "Craft Supplies & Tools", subcategory: "Beads" },
  "beads & jewelry making": { category: "Craft Supplies & Tools", subcategory: "Beads" },
  fabric: { category: "Craft Supplies & Tools", subcategory: "Fabric" },
  yarn: { category: "Craft Supplies & Tools", subcategory: "Yarn" },
  "sewing & needlecraft": { category: "Craft Supplies & Tools", subcategory: "Sewing & Needlecraft" },
  patterns: { category: "Craft Supplies & Tools", subcategory: "Patterns & How To" },
  "patterns & how to": { category: "Craft Supplies & Tools", subcategory: "Patterns & How To" },

  // Electronics expanded
  electronics: { category: "Electronics & Accessories", subcategory: null },
  "phone cases": { category: "Electronics & Accessories", subcategory: "Phone Cases" },
  "gadgets": { category: "Electronics & Accessories", subcategory: null },

  // Home & Living expanded
  "home": { category: "Home & Living", subcategory: null },
  "living room": { category: "Home & Living", subcategory: "Living Room" },
  rugs: { category: "Home & Living", subcategory: "Rugs" },
  curtains: { category: "Home & Living", subcategory: "Curtains & Window Treatments" },
  "curtains & window treatments": { category: "Home & Living", subcategory: "Curtains & Window Treatments" },
  pillows: { category: "Home & Living", subcategory: "Pillows" },
  blankets: { category: "Home & Living", subcategory: "Blankets & Throws" },
  "blankets & throws": { category: "Home & Living", subcategory: "Blankets & Throws" },
  candles: { category: "Home & Living", subcategory: "Candles & Holders" },
  "candles & holders": { category: "Home & Living", subcategory: "Candles & Holders" },
  vases: { category: "Home & Living", subcategory: "Vases" },
  clocks: { category: "Home & Living", subcategory: "Clocks" },
  mirrors: { category: "Home & Living", subcategory: "Mirrors" },
  frames: { category: "Home & Living", subcategory: "Frames & Displays" },
  "picture frames": { category: "Home & Living", subcategory: "Frames & Displays" },
  "outdoor & garden": { category: "Home & Garden", subcategory: "Outdoor & Gardening" },
  "outdoor & gardening": { category: "Home & Garden", subcategory: "Outdoor & Gardening" },
  planters: { category: "Home & Garden", subcategory: "Outdoor & Gardening" },

  // Jewelry expanded
  "fine jewelry": { category: "Jewelry & Watches", subcategory: null },
  pendants: { category: "Jewelry & Watches", subcategory: "Necklaces & Pendants" },
  charms: { category: "Jewelry & Watches", subcategory: "Charms" },
  brooch: { category: "Jewelry & Watches", subcategory: "Brooches" },
  brooches: { category: "Jewelry & Watches", subcategory: "Brooches" },
  anklets: { category: "Jewelry & Watches", subcategory: "Anklets" },

  // Paper & Party expanded
  cards: { category: "Paper & Party Supplies", subcategory: "Greeting Cards" },
  "stationery": { category: "Paper & Party Supplies", subcategory: "Stationery" },
  "journals & notebooks": { category: "Paper & Party Supplies", subcategory: "Journals & Notebooks" },
  journals: { category: "Paper & Party Supplies", subcategory: "Journals & Notebooks" },
  notebooks: { category: "Paper & Party Supplies", subcategory: "Journals & Notebooks" },
  calendars: { category: "Paper & Party Supplies", subcategory: "Calendars & Planners" },
  planners: { category: "Paper & Party Supplies", subcategory: "Calendars & Planners" },
  "calendars & planners": { category: "Paper & Party Supplies", subcategory: "Calendars & Planners" },
  "party supplies": { category: "Paper & Party Supplies", subcategory: "Party Decorations" },
  balloons: { category: "Paper & Party Supplies", subcategory: "Party Decorations" },
  banners: { category: "Paper & Party Supplies", subcategory: "Party Decorations" },

  // Toys & Games expanded
  toys: { category: "Toys & Games", subcategory: null },
  games: { category: "Toys & Games", subcategory: null },
  puzzles: { category: "Toys & Games", subcategory: "Board Games & Puzzles" },
  dolls: { category: "Toys & Games", subcategory: "Dolls & Stuffed Animals" },
  "action figures": { category: "Toys & Games", subcategory: "Action Figures" },
  "learning & school": { category: "Toys & Games", subcategory: "Learning & School" },

  // Baby & Kids (Etsy often uses these)
  baby: { category: "Baby & Kids", subcategory: null },
  "baby & toddler toys": { category: "Baby & Kids", subcategory: "Toys" },
  "baby clothing": { category: "Baby & Kids", subcategory: "Baby Clothing" },
  "kids' clothing": { category: "Baby & Kids", subcategory: "Kids' Clothing" },
  "kids clothing": { category: "Baby & Kids", subcategory: "Kids' Clothing" },
  "children's clothing": { category: "Baby & Kids", subcategory: "Kids' Clothing" },
  nursery: { category: "Baby & Kids", subcategory: "Nursery" },
  "nursery decor": { category: "Baby & Kids", subcategory: "Nursery" },

  // Bags expanded
  clutches: { category: "Bags & Purses", subcategory: "Clutches & Evening Bags" },
  "clutches & evening bags": { category: "Bags & Purses", subcategory: "Clutches & Evening Bags" },
  "messenger bags": { category: "Bags & Purses", subcategory: "Messenger Bags" },
  "luggage & travel": { category: "Bags & Purses", subcategory: "Luggage & Travel" },
  "cosmetic & toiletry bags": { category: "Bags & Purses", subcategory: "Cosmetic Bags" },
  purses: { category: "Bags & Purses", subcategory: "Handbags" },
  bags: { category: "Bags & Purses", subcategory: null },

  // Sports & Outdoors
  sports: { category: "Sports & Outdoors", subcategory: null },
  "sports & recreation": { category: "Sports & Outdoors", subcategory: null },
  camping: { category: "Sports & Outdoors", subcategory: "Camping & Hiking" },
  "camping & hiking": { category: "Sports & Outdoors", subcategory: "Camping & Hiking" },
  fitness: { category: "Sports & Outdoors", subcategory: "Fitness & Exercise" },
  yoga: { category: "Sports & Outdoors", subcategory: "Fitness & Exercise" },
};

/**
 * Common Wix store collection / ribbon names → INW presets.
 * Sellers often name collections after Etsy-like or retail categories.
 */
const WIX_CATEGORY_ALIASES: Record<string, AliasHit> = {
  ...ETSY_CATEGORY_ALIASES,
  apparel: { category: "Clothing", subcategory: null },
  fashion: { category: "Clothing", subcategory: null },
  "home goods": { category: "Home & Living", subcategory: "Home Decor" },
  decor: { category: "Home & Living", subcategory: "Home Decor" },
  gifts: { category: "Paper & Party Supplies", subcategory: "Gift Wrap & Packaging" },
  "gift ideas": { category: "Paper & Party Supplies", subcategory: "Gift Wrap & Packaging" },
  beauty: { category: "Bath & Beauty", subcategory: null },
  skincare: { category: "Bath & Beauty", subcategory: "Skin Care" },
  jewellery: { category: "Jewelry & Watches", subcategory: null },
  kids: { category: "Baby & Kids", subcategory: null },
  baby: { category: "Baby & Kids", subcategory: null },
  outdoors: { category: "Sports & Outdoors", subcategory: "Outdoor Gear" },
  sports: { category: "Sports & Outdoors", subcategory: null },
  electronics: { category: "Electronics & Accessories", subcategory: null },
  tech: { category: "Electronics & Accessories", subcategory: null },
  stationery: { category: "Office & School Supplies", subcategory: "Stationery" },
  party: { category: "Paper & Party Supplies", subcategory: "Party Decorations" },
  pets: { category: "Pet Supplies", subcategory: null },
};

/** Labels that are never useful as Wix/Etsy category sources. */
const NOISE_CATEGORY_LABELS = new Set([
  "physical",
  "digital",
  "service",
  "unspecified",
  "other",
  "n a",
  "na",
  "none",
  "general",
  // Wix marketing collections — not real product categories
  "all products",
  "new arrivals",
  "best sellers",
  "bestsellers",
  "sale",
  "on sale",
  "featured",
  "shop all",
]);

export type ResolvedInwCategory = {
  category: string;
  subcategory: string | null;
  /** True when mapped to a preset from STORE_CATEGORIES; false when stored as custom text. */
  matchedPreset: boolean;
  /** Similarity score when fuzzy-matched (1 for exact alias). */
  score?: number;
};

export type ResolveCategoryOptions = {
  provider?: ChannelProvider;
  /**
   * When true (default for etsy/wix), always pick the closest INW preset above
   * CLOSEST_PRESET_FLOOR instead of storing the raw remote label.
   */
  closestPreset?: boolean;
};

function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(s: string): Set<string> {
  const n = normalizeLabel(s);
  if (!n) return new Set();
  return new Set(n.split(" ").filter((t) => t.length > 1));
}

/** Token overlap / Jaccard-style score between two labels. */
export function similarityScore(a: string, b: string): number {
  const na = normalizeLabel(a);
  const nb = normalizeLabel(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;

  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter += 1;
  }
  const union = ta.size + tb.size - inter;
  return union > 0 ? inter / union : 0;
}

type Candidate = { category: string; subcategory: string | null; score: number };

function bestPresetMatch(remoteLabel: string, remoteSubLabel?: string | null): Candidate | null {
  const combined = remoteSubLabel?.trim()
    ? `${remoteLabel} ${remoteSubLabel}`.trim()
    : remoteLabel.trim();
  if (!combined) return null;

  let best: Candidate | null = null;

  for (const preset of STORE_CATEGORIES) {
    const labelScore = similarityScore(combined, preset.label);
    if (labelScore > (best?.score ?? 0)) {
      best = { category: preset.label, subcategory: null, score: labelScore };
    }
    for (const sub of preset.subcategories) {
      const subScore = Math.max(
        similarityScore(combined, sub),
        similarityScore(combined, `${preset.label} ${sub}`) * 0.98
      );
      if (subScore > (best?.score ?? 0)) {
        best = { category: preset.label, subcategory: sub, score: subScore };
      }
    }
  }

  if (remoteSubLabel?.trim()) {
    for (const preset of STORE_CATEGORIES) {
      const parentScore = similarityScore(remoteLabel, preset.label);
      for (const sub of preset.subcategories) {
        const s = similarityScore(remoteSubLabel, sub);
        if (parentScore >= 0.85 && s > (best?.score ?? 0)) {
          best = {
            category: preset.label,
            subcategory: sub,
            score: Math.max(s, parentScore * 0.95),
          };
        }
        if (
          parentScore >= CATEGORY_MATCH_THRESHOLD &&
          s >= CATEGORY_MATCH_THRESHOLD
        ) {
          const score = (parentScore + s) / 2;
          if (score > (best?.score ?? 0)) {
            best = { category: preset.label, subcategory: sub, score };
          }
        }
      }
    }
  }

  return best;
}

function aliasesForProvider(provider?: ChannelProvider): Record<string, AliasHit> {
  if (provider === "etsy") return ETSY_CATEGORY_ALIASES;
  if (provider === "wix") return WIX_CATEGORY_ALIASES;
  if (provider === "ebay") return EBAY_CATEGORY_ALIASES;
  // Shopify / unknown: combine Etsy + eBay retail-ish aliases
  return { ...ETSY_CATEGORY_ALIASES, ...EBAY_CATEGORY_ALIASES };
}

/**
 * Prefer the longest matching alias key (avoids short keys like "art" winning over
 * "art & collectibles"). Exact match beats substring.
 */
function matchAlias(
  remoteLabel: string,
  remoteSubLabel: string | null | undefined,
  aliases: Record<string, AliasHit>
): ResolvedInwCategory | null {
  const combined = remoteSubLabel?.trim()
    ? `${remoteLabel} ${remoteSubLabel}`.trim()
    : remoteLabel.trim();
  const candidates = [
    { text: normalizeLabel(combined), weight: 1 },
    { text: normalizeLabel(remoteLabel), weight: 0.98 },
    ...(remoteSubLabel?.trim()
      ? [{ text: normalizeLabel(remoteSubLabel), weight: 0.96 }]
      : []),
  ].filter((c) => c.text);

  let best: { hit: AliasHit; keyLen: number; exact: boolean } | null = null;

  for (const { text } of candidates) {
    for (const [key, mapping] of Object.entries(aliases)) {
      const normalizedKey = normalizeLabel(key);
      if (!normalizedKey || normalizedKey.length < 3) continue;
      const exact = text === normalizedKey;
      const partial = !exact && text.includes(normalizedKey);
      if (!exact && !partial) continue;
      // Require key to be a meaningful chunk (avoid matching "art" inside "party")
      if (!exact && normalizedKey.length < 5 && !text.split(" ").includes(normalizedKey)) {
        continue;
      }
      const keyLen = normalizedKey.length;
      if (
        !best ||
        (exact && !best.exact) ||
        (exact === best.exact && keyLen > best.keyLen)
      ) {
        best = { hit: mapping, keyLen, exact };
      }
    }
  }

  if (!best) return null;
  return {
    category: best.hit.category,
    subcategory: best.hit.subcategory,
    matchedPreset: true,
    score: 1,
  };
}

function isNoiseLabel(label: string): boolean {
  return NOISE_CATEGORY_LABELS.has(normalizeLabel(label));
}

/** Best subcategory under a known INW top-level for a remote leaf label. */
function refineSubcategory(category: string, remoteSub: string): string | null {
  const preset = STORE_CATEGORIES.find((c) => c.label === category);
  if (!preset) return null;
  let best: { sub: string; score: number } | null = null;
  for (const sub of preset.subcategories) {
    const score = similarityScore(remoteSub, sub);
    if (score >= 0.55 && score > (best?.score ?? 0)) {
      best = { sub, score };
    }
  }
  // Exact alias mid-level keys under this category (e.g. Greeting Cards).
  const n = normalizeLabel(remoteSub);
  for (const [key, hit] of Object.entries({
    ...ETSY_CATEGORY_ALIASES,
    ...WIX_CATEGORY_ALIASES,
    ...EBAY_CATEGORY_ALIASES,
  })) {
    if (hit.category !== category || !hit.subcategory) continue;
    if (n === normalizeLabel(key) || n.includes(normalizeLabel(key))) {
      return hit.subcategory;
    }
  }
  return best?.sub ?? null;
}

function shouldUseClosestPreset(
  provider: ChannelProvider | undefined,
  opts?: ResolveCategoryOptions
): boolean {
  if (opts?.closestPreset != null) return opts.closestPreset;
  return provider === "etsy" || provider === "wix" || provider === "shopify" || provider === "ebay";
}

/**
 * Map a remote category label to an INW shop category.
 * Provider-specific aliases run first, then fuzzy matching.
 * Etsy/Wix default to closest-preset mode so sync never invents orphan custom labels
 * when a reasonable INW match exists.
 */
export function resolveInwCategoryFromRemote(
  remoteLabel: string | null | undefined,
  remoteSubLabel?: string | null,
  opts?: ResolveCategoryOptions
): ResolvedInwCategory | null {
  let label = remoteLabel?.trim() ?? "";
  let sub = remoteSubLabel?.trim() || null;

  // Wix often puts "physical" in productType — treat as missing.
  if (label && isNoiseLabel(label)) {
    if (sub && !isNoiseLabel(sub)) {
      label = sub;
      sub = null;
    } else {
      return null;
    }
  }
  if (sub && isNoiseLabel(sub)) sub = null;
  if (!label) return null;

  const aliases = aliasesForProvider(opts?.provider);

  // eBay PrimaryCategory is usually "Root > Mid > Leaf" — try each path segment first.
  if (opts?.provider === "ebay" && label.includes(">")) {
    for (const segment of ebayCategoryPathCandidates(label)) {
      const segHit = matchAlias(segment, sub, aliases);
      if (segHit) {
        if (!segHit.subcategory && sub) {
          const refined = refineSubcategory(segHit.category, sub);
          if (refined) return { ...segHit, subcategory: refined };
        }
        return segHit;
      }
    }
    const split = splitEbayCategoryPath(label);
    label = split.label;
    if (!sub && split.subcategory) sub = split.subcategory;
  }

  let aliasMatch = matchAlias(label, sub, aliases);

  // Also try eBay aliases as a shared collectibles backstop for all providers.
  if (!aliasMatch && opts?.provider !== "ebay") {
    aliasMatch = matchAlias(label, sub, EBAY_CATEGORY_ALIASES);
  }

  if (aliasMatch) {
    // Refine subcategory when alias only hit the top-level (e.g. Home & Living + Wall Decor).
    if (!aliasMatch.subcategory && sub) {
      const refined = refineSubcategory(aliasMatch.category, sub);
      if (refined) {
        return {
          ...aliasMatch,
          subcategory: refined,
        };
      }
    }
    return aliasMatch;
  }

  const best = bestPresetMatch(label, sub);
  const closest = shouldUseClosestPreset(opts?.provider, opts);

  if (best && best.score >= CATEGORY_MATCH_THRESHOLD) {
    return {
      category: best.category,
      subcategory: best.subcategory,
      matchedPreset: true,
      score: best.score,
    };
  }

  if (closest && best && best.score >= CLOSEST_PRESET_FLOOR) {
    return {
      category: best.category,
      subcategory: best.subcategory,
      matchedPreset: true,
      score: best.score,
    };
  }

  // Strict fallback: keep remote label as custom (eBay default).
  // Log unmapped categories to help identify gaps in aliases
  console.log("[category-resolver] unmapped category from remote", {
    provider: opts?.provider ?? "unknown",
    remoteLabel: label,
    remoteSubLabel: sub,
    bestMatchScore: best?.score,
    bestMatchCategory: best?.category,
    closestPresetMode: closest,
  });

  return {
    category: label.slice(0, 200),
    subcategory: sub?.slice(0, 200) ?? null,
    matchedPreset: false,
    score: best?.score,
  };
}

/** Display / outbound label from a StoreItem's category fields. */
export function categoryLabelForDisplay(item: {
  category: string | null;
  subcategory?: string | null;
}): string {
  const cat = item.category?.trim();
  if (!cat) return "";
  const sub = item.subcategory?.trim();
  return sub ? `${cat} › ${sub}` : cat;
}

// ============================================================================
// ML-Style Category Suggestions from Title + Description
// ============================================================================

/**
 * Keywords that strongly indicate specific categories.
 * Each keyword can have a weight (higher = stronger match).
 */
const CATEGORY_KEYWORDS: Record<string, { keywords: string[]; weight?: number }[]> = {
  "Art & Collectibles": [
    { keywords: ["art", "painting", "print", "canvas", "sculpture", "artwork"], weight: 1.0 },
    { keywords: ["collectible", "vintage", "antique", "memorabilia", "autograph"], weight: 0.9 },
    { keywords: ["coin", "currency", "stamp", "trading card", "sports card"], weight: 0.85 },
  ],
  "Accessories": [
    { keywords: ["hat", "cap", "beanie", "fedora", "visor"], weight: 1.0 },
    { keywords: ["scarf", "wrap", "shawl"], weight: 0.9 },
    { keywords: ["belt", "suspenders"], weight: 0.9 },
    { keywords: ["sunglasses", "eyewear", "glasses"], weight: 0.9 },
    { keywords: ["keychain", "lanyard", "badge", "pin"], weight: 0.85 },
  ],
  "Bags & Purses": [
    { keywords: ["bag", "purse", "handbag", "tote", "clutch"], weight: 1.0 },
    { keywords: ["backpack", "rucksack"], weight: 1.0 },
    { keywords: ["wallet", "card holder", "billfold"], weight: 0.9 },
    { keywords: ["messenger", "crossbody", "satchel"], weight: 0.9 },
  ],
  "Bath & Beauty": [
    { keywords: ["soap", "bath bomb", "body wash"], weight: 1.0 },
    { keywords: ["lotion", "cream", "moisturizer", "skincare"], weight: 0.95 },
    { keywords: ["makeup", "cosmetic", "lipstick", "mascara"], weight: 0.95 },
    { keywords: ["perfume", "cologne", "fragrance", "essential oil"], weight: 0.9 },
    { keywords: ["shampoo", "conditioner", "hair care"], weight: 0.9 },
  ],
  "Books, Movies & Music": [
    { keywords: ["book", "novel", "paperback", "hardcover"], weight: 1.0 },
    { keywords: ["dvd", "blu-ray", "movie", "film"], weight: 0.95 },
    { keywords: ["cd", "vinyl", "record", "album"], weight: 0.95 },
    { keywords: ["video game", "game disc"], weight: 0.9 },
    { keywords: ["comic", "manga", "graphic novel"], weight: 0.9 },
  ],
  "Clothing": [
    { keywords: ["shirt", "blouse", "top", "tee", "t-shirt"], weight: 1.0 },
    { keywords: ["dress", "gown", "skirt"], weight: 1.0 },
    { keywords: ["pants", "jeans", "trousers", "shorts"], weight: 1.0 },
    { keywords: ["jacket", "coat", "blazer", "hoodie", "sweater"], weight: 1.0 },
    { keywords: ["suit", "vest", "cardigan"], weight: 0.95 },
  ],
  "Craft Supplies & Tools": [
    { keywords: ["yarn", "thread", "fabric", "sewing"], weight: 1.0 },
    { keywords: ["bead", "charm", "jewelry making"], weight: 0.95 },
    { keywords: ["craft", "diy", "supplies"], weight: 0.85 },
    { keywords: ["pattern", "template", "stencil"], weight: 0.8 },
  ],
  "Electronics & Accessories": [
    { keywords: ["phone case", "phone cover", "tablet case"], weight: 1.0 },
    { keywords: ["charger", "cable", "adapter", "usb"], weight: 0.95 },
    { keywords: ["headphone", "earphone", "earbud", "speaker"], weight: 0.95 },
    { keywords: ["electronic", "gadget", "tech"], weight: 0.8 },
  ],
  "Furniture": [
    { keywords: ["chair", "table", "desk", "bench"], weight: 1.0 },
    { keywords: ["sofa", "couch", "loveseat"], weight: 1.0 },
    { keywords: ["shelf", "bookcase", "cabinet", "dresser"], weight: 0.95 },
    { keywords: ["bed", "headboard", "nightstand"], weight: 0.95 },
  ],
  "Home & Living": [
    { keywords: ["pillow", "cushion", "throw"], weight: 0.95 },
    { keywords: ["candle", "holder", "diffuser"], weight: 0.9 },
    { keywords: ["vase", "planter", "pot"], weight: 0.9 },
    { keywords: ["decor", "decoration", "ornament"], weight: 0.85 },
    { keywords: ["blanket", "quilt", "bedding"], weight: 0.9 },
  ],
  "Jewelry & Watches": [
    { keywords: ["necklace", "pendant", "chain"], weight: 1.0 },
    { keywords: ["bracelet", "bangle", "cuff"], weight: 1.0 },
    { keywords: ["earring", "stud", "hoop"], weight: 1.0 },
    { keywords: ["ring", "band"], weight: 0.95 },
    { keywords: ["watch", "wristwatch"], weight: 1.0 },
    { keywords: ["jewelry", "jewellery"], weight: 0.9 },
  ],
  "Paper & Party Supplies": [
    { keywords: ["card", "greeting card", "invitation"], weight: 0.95 },
    { keywords: ["sticker", "label", "decal"], weight: 0.9 },
    { keywords: ["party", "decoration", "banner", "balloon"], weight: 0.9 },
    { keywords: ["gift wrap", "wrapping paper"], weight: 0.9 },
    { keywords: ["planner", "journal", "notebook"], weight: 0.85 },
  ],
  "Pet Supplies": [
    { keywords: ["dog", "puppy", "canine"], weight: 0.95 },
    { keywords: ["cat", "kitten", "feline"], weight: 0.95 },
    { keywords: ["pet", "collar", "leash", "harness"], weight: 0.9 },
    { keywords: ["pet toy", "pet bed", "pet bowl"], weight: 0.9 },
  ],
  "Shoes": [
    { keywords: ["shoe", "sneaker", "trainer"], weight: 1.0 },
    { keywords: ["boot", "ankle boot", "combat boot"], weight: 1.0 },
    { keywords: ["sandal", "flip flop", "slide"], weight: 1.0 },
    { keywords: ["heel", "pump", "stiletto"], weight: 0.95 },
    { keywords: ["loafer", "flat", "moccasin"], weight: 0.95 },
  ],
  "Sports & Outdoors": [
    { keywords: ["sport", "athletic", "fitness", "exercise"], weight: 0.9 },
    { keywords: ["camping", "hiking", "outdoor"], weight: 0.9 },
    { keywords: ["yoga", "mat", "gym"], weight: 0.85 },
    { keywords: ["golf", "tennis", "basketball", "soccer", "football"], weight: 0.9 },
  ],
  "Toys & Games": [
    { keywords: ["toy", "doll", "action figure"], weight: 1.0 },
    { keywords: ["game", "board game", "puzzle"], weight: 0.95 },
    { keywords: ["plush", "stuffed animal", "teddy"], weight: 0.95 },
    { keywords: ["lego", "building blocks"], weight: 0.9 },
  ],
  "Wedding": [
    { keywords: ["wedding", "bridal", "bride"], weight: 1.0 },
    { keywords: ["bridesmaid", "groom", "groomsman"], weight: 0.95 },
    { keywords: ["engagement", "ceremony", "reception"], weight: 0.9 },
  ],
  "Baby & Kids": [
    { keywords: ["baby", "infant", "newborn", "toddler"], weight: 1.0 },
    { keywords: ["kids", "children", "child"], weight: 0.95 },
    { keywords: ["nursery", "crib", "stroller"], weight: 0.9 },
    { keywords: ["onesie", "romper", "bib"], weight: 0.9 },
  ],
};

export type CategorySuggestion = {
  category: string;
  subcategory: string | null;
  confidence: number;
  matchedKeywords?: string[];
};

/**
 * Suggest categories based on title and description content.
 * Uses keyword matching with weighted scoring.
 */
export function suggestCategoriesFromContent(
  title: string,
  description?: string | null
): CategorySuggestion[] {
  const text = `${title} ${description ?? ""}`.toLowerCase();
  const suggestions: Map<string, { score: number; keywords: string[] }> = new Map();

  for (const [category, keywordGroups] of Object.entries(CATEGORY_KEYWORDS)) {
    let totalScore = 0;
    const matchedKeywords: string[] = [];

    for (const group of keywordGroups) {
      const weight = group.weight ?? 1.0;
      for (const keyword of group.keywords) {
        // Check for word boundaries to avoid partial matches
        const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(text)) {
          // Score based on position (title matches count more)
          const inTitle = regex.test(title.toLowerCase());
          const positionBonus = inTitle ? 0.3 : 0;
          totalScore += weight + positionBonus;
          matchedKeywords.push(keyword);
        }
      }
    }

    if (totalScore > 0) {
      suggestions.set(category, { score: totalScore, keywords: matchedKeywords });
    }
  }

  // Convert to array and sort by score
  const sortedSuggestions = Array.from(suggestions.entries())
    .map(([category, { score, keywords }]) => ({
      category,
      subcategory: null as string | null,
      confidence: Math.min(0.95, score / 3), // Normalize to 0-0.95
      matchedKeywords: keywords,
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);

  // Try to match subcategories for top suggestions
  for (const suggestion of sortedSuggestions) {
    const preset = STORE_CATEGORIES.find((c) => c.label === suggestion.category);
    if (preset) {
      let bestSubScore = 0;
      let bestSub: string | null = null;
      for (const sub of preset.subcategories) {
        const subScore = similarityScore(text, sub.toLowerCase());
        if (subScore > bestSubScore && subScore >= 0.3) {
          bestSubScore = subScore;
          bestSub = sub;
        }
      }
      if (bestSub) {
        suggestion.subcategory = bestSub;
        suggestion.confidence = Math.min(0.98, suggestion.confidence + 0.1);
      }
    }
  }

  return sortedSuggestions;
}

// ============================================================================
// Category Mapping Feedback & Learning
// ============================================================================

import { prisma } from "database";

/**
 * Record when a seller overrides an auto-mapped category.
 * This data is used to improve future auto-mapping accuracy.
 */
export async function recordCategoryFeedback(params: {
  provider: ChannelProvider;
  remoteCategory: string;
  remoteSubcategory?: string | null;
  autoMapped: string;
  autoMappedSubcategory?: string | null;
  sellerChosen: string;
  sellerChosenSubcategory?: string | null;
  confidence?: number;
  storeItemId?: string;
  memberId: string;
}): Promise<void> {
  const {
    provider,
    remoteCategory,
    remoteSubcategory,
    autoMapped,
    autoMappedSubcategory,
    sellerChosen,
    sellerChosenSubcategory,
    confidence,
    storeItemId,
    memberId,
  } = params;

  // Don't record if seller kept the auto-mapped category
  const keptAutoMapped =
    autoMapped === sellerChosen &&
    (autoMappedSubcategory ?? null) === (sellerChosenSubcategory ?? null);

  try {
    // Record the feedback
    await prisma.categoryMappingFeedback.create({
      data: {
        provider,
        remoteCategory,
        remoteSubcat: remoteSubcategory ?? null,
        autoMapped,
        autoMappedSub: autoMappedSubcategory ?? null,
        sellerChosen,
        sellerChosenSub: sellerChosenSubcategory ?? null,
        confidence: confidence ?? null,
        storeItemId: storeItemId ?? null,
        memberId,
      },
    });

    // Update aggregated stats
    await prisma.categoryMappingStats.upsert({
      where: {
        provider_remoteCategory: { provider, remoteCategory },
      },
      create: {
        provider,
        remoteCategory,
        mappedCategory: sellerChosen,
        mappedSubcat: sellerChosenSubcategory ?? null,
        confidence: keptAutoMapped ? 0.6 : 0.4,
        overrideCount: keptAutoMapped ? 0 : 1,
        keepCount: keptAutoMapped ? 1 : 0,
      },
      update: {
        mappedCategory: keptAutoMapped ? undefined : sellerChosen,
        mappedSubcat: keptAutoMapped ? undefined : (sellerChosenSubcategory ?? null),
        overrideCount: keptAutoMapped ? undefined : { increment: 1 },
        keepCount: keptAutoMapped ? { increment: 1 } : undefined,
      },
    });
  } catch (e) {
    console.warn("[category-feedback] failed to record:", e);
  }
}

/**
 * Get learned mapping for a remote category based on seller feedback.
 * Returns null if no strong mapping exists.
 */
export async function getLearnedCategoryMapping(
  provider: ChannelProvider,
  remoteCategory: string
): Promise<ResolvedInwCategory | null> {
  try {
    const stats = await prisma.categoryMappingStats.findUnique({
      where: {
        provider_remoteCategory: { provider, remoteCategory },
      },
    });

    if (!stats) return null;

    // Calculate confidence based on feedback
    const totalFeedback = stats.keepCount + stats.overrideCount;
    if (totalFeedback < 3) return null; // Need at least 3 data points

    const keepRate = stats.keepCount / totalFeedback;
    const adjustedConfidence = keepRate * 0.8 + 0.2; // Scale to 0.2-1.0

    if (adjustedConfidence < CATEGORY_MATCH_THRESHOLD) return null;

    return {
      category: stats.mappedCategory,
      subcategory: stats.mappedSubcat,
      matchedPreset: true,
      score: adjustedConfidence,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve an eBay PrimaryCategory path to an INW preset (with learning + aliases).
 */
export async function resolveInwCategoryFromEbayPath(
  categoryPath: string | null | undefined
): Promise<ResolvedInwCategory | null> {
  if (!categoryPath?.trim()) return null;
  const { label, subcategory } = splitEbayCategoryPath(categoryPath);
  return resolveInwCategoryWithLearning(label, subcategory, { provider: "ebay" });
}

/**
 * Seed mapping stats when an import auto-assigns a category (speeds up adaptive learning).
 */
export async function seedCategoryMappingFromImport(params: {
  provider: ChannelProvider;
  remoteCategory: string;
  remoteSubcategory?: string | null;
  mappedCategory: string;
  mappedSubcategory?: string | null;
  confidence?: number;
}): Promise<void> {
  const remote = params.remoteCategory.trim();
  if (!remote) return;

  try {
    await prisma.categoryMappingStats.upsert({
      where: {
        provider_remoteCategory: { provider: params.provider, remoteCategory: remote },
      },
      create: {
        provider: params.provider,
        remoteCategory: remote,
        mappedCategory: params.mappedCategory,
        mappedSubcat: params.mappedSubcategory ?? null,
        confidence: params.confidence ?? 0.55,
        keepCount: 1,
        overrideCount: 0,
      },
      update: {
        mappedCategory: params.mappedCategory,
        mappedSubcat: params.mappedSubcategory ?? null,
        keepCount: { increment: 1 },
      },
    });
  } catch (e) {
    console.warn("[category-mapping] seed import stats failed:", e);
  }
}

/**
 * Enhanced category resolution that considers learned mappings.
 */
export async function resolveInwCategoryWithLearning(
  remoteLabel: string | null | undefined,
  remoteSubLabel?: string | null,
  opts?: ResolveCategoryOptions
): Promise<ResolvedInwCategory | null> {
  const label = remoteLabel?.trim();
  if (!label) return null;

  // First, check for learned mappings from seller feedback
  if (opts?.provider) {
    const learned = await getLearnedCategoryMapping(opts.provider, label);
    if (learned && (learned.score ?? 0) >= CATEGORY_MATCH_THRESHOLD) {
      return learned;
    }
  }

  // Fall back to standard resolution
  return resolveInwCategoryFromRemote(remoteLabel, remoteSubLabel, opts);
}

/**
 * Get category mapping statistics for admin analytics.
 */
export async function getCategoryMappingAnalytics(params: {
  provider?: string;
  limit?: number;
}): Promise<{
  stats: Array<{
    provider: string;
    remoteCategory: string;
    mappedCategory: string;
    mappedSubcat: string | null;
    confidence: number;
    overrideCount: number;
    keepCount: number;
    overrideRate: number;
  }>;
  total: number;
}> {
  const { provider, limit = 50 } = params;

  const where = provider ? { provider } : {};

  const [stats, total] = await Promise.all([
    prisma.categoryMappingStats.findMany({
      where,
      orderBy: { overrideCount: "desc" },
      take: limit,
    }),
    prisma.categoryMappingStats.count({ where }),
  ]);

  return {
    stats: stats.map((s) => ({
      provider: s.provider,
      remoteCategory: s.remoteCategory,
      mappedCategory: s.mappedCategory,
      mappedSubcat: s.mappedSubcat,
      confidence: s.confidence,
      overrideCount: s.overrideCount,
      keepCount: s.keepCount,
      overrideRate:
        s.overrideCount + s.keepCount > 0
          ? s.overrideCount / (s.overrideCount + s.keepCount)
          : 0,
    })),
    total,
  };
}
