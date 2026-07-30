import { STORE_CATEGORIES } from "@/lib/store-categories";
import type { ChannelProvider } from "./types";

/** Minimum similarity score (0–1) to map a remote label to a preset INW category (strict mode). */
export const CATEGORY_MATCH_THRESHOLD = 0.72;

/**
 * Floor for "closest preset" mode used by Etsy/Wix sync — always pick the best INW
 * preset above this score instead of storing a raw marketplace label.
 */
export const CLOSEST_PRESET_FLOOR = 0.28;

type AliasHit = { category: string; subcategory: string | null };

/**
 * Explicit mappings from common eBay category names/fragments to INW presets.
 * Keys are normalized (lowercase, trimmed). Longer keys win over short ones.
 */
const EBAY_CATEGORY_ALIASES: Record<string, AliasHit> = {
  "coins & paper money": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "coins paper money": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "coins: us": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "coins: world": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "coins us": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "coins world": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "paper money: us": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "paper money: world": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  bullion: { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  exonumia: { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  stamps: { category: "Art & Collectibles", subcategory: "Stamps" },
  "stamps: united states": { category: "Art & Collectibles", subcategory: "Stamps" },
  "stamps: worldwide": { category: "Art & Collectibles", subcategory: "Stamps" },
  "sports trading cards": { category: "Art & Collectibles", subcategory: "Trading Cards" },
  "non-sport trading cards": { category: "Art & Collectibles", subcategory: "Trading Cards" },
  "trading cards": { category: "Art & Collectibles", subcategory: "Trading Cards" },
  "sports mem, cards & fan shop": { category: "Art & Collectibles", subcategory: "Trading Cards" },
  comics: { category: "Books, Movies & Music", subcategory: "Comics & Graphic Novels" },
  "comic books": { category: "Books, Movies & Music", subcategory: "Comics & Graphic Novels" },
  "collectibles: comic books & memorabilia": {
    category: "Books, Movies & Music",
    subcategory: "Comics & Graphic Novels",
  },
  collectibles: { category: "Art & Collectibles", subcategory: null },
  antiques: { category: "Art & Collectibles", subcategory: "Vintage & Antiques" },
  "pottery & glass": { category: "Art & Collectibles", subcategory: null },
  "entertainment memorabilia": { category: "Art & Collectibles", subcategory: "Memorabilia" },
  "music memorabilia": { category: "Art & Collectibles", subcategory: "Memorabilia" },
  "movie memorabilia": { category: "Art & Collectibles", subcategory: "Memorabilia" },
  autographs: { category: "Art & Collectibles", subcategory: "Memorabilia" },
};

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
  for (const [key, hit] of Object.entries({ ...ETSY_CATEGORY_ALIASES, ...WIX_CATEGORY_ALIASES })) {
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
  return provider === "etsy" || provider === "wix" || provider === "shopify";
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
