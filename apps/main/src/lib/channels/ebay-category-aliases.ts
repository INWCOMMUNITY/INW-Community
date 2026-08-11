/**
 * eBay US marketplace category labels → INW store presets.
 * Keys are normalized (lowercase). Longer / more specific keys win in the resolver.
 *
 * Sources: eBay category tree top-levels, common leaf paths, and INW outbound mappings.
 */

export type EbayAliasHit = { category: string; subcategory: string | null };

/** Normalize for alias lookup (matches category-resolver). */
export function normalizeEbayLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split eBay PrimaryCategory path "A > B > C" into segments for matching.
 * Returns root, leaf, full path, and every segment (most specific first).
 */
export function ebayCategoryPathCandidates(path: string | null | undefined): string[] {
  const raw = path?.trim();
  if (!raw) return [];

  const parts = raw.split(">").map((p) => p.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (s: string) => {
    const t = s.trim();
    if (!t) return;
    const key = normalizeEbayLabel(t);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  };

  if (parts.length >= 2) {
    push(parts[parts.length - 1]!); // leaf (most specific)
    for (let i = parts.length - 2; i >= 1; i--) push(parts[i]!);
    push(parts.slice(-2).join(" > "));
    push(parts[0]!);
    push(raw); // full path last
  } else if (parts.length === 1) {
    push(parts[0]!);
  } else {
    push(raw);
  }

  return out;
}

/** Best-effort parent + leaf split for fuzzy resolution input. */
export function splitEbayCategoryPath(path: string | null | undefined): {
  label: string;
  subcategory: string | null;
} {
  const raw = path?.trim();
  if (!raw) return { label: "", subcategory: null };

  const parts = raw.split(">").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { label: raw, subcategory: null };
  return {
    label: parts[0]!,
    subcategory: parts[parts.length - 1]!,
  };
}

export const EBAY_CATEGORY_ALIASES: Record<string, EbayAliasHit> = {
  // ── Top-level eBay roots ─────────────────────────────────────────────
  "clothing shoes and accessories": { category: "Clothing", subcategory: null },
  "clothing shoes accessories": { category: "Clothing", subcategory: null },
  "home and garden": { category: "Home & Living", subcategory: null },
  "home garden": { category: "Home & Living", subcategory: null },
  "sporting goods": { category: "Sports & Outdoors", subcategory: null },
  "health and beauty": { category: "Bath & Beauty", subcategory: null },
  "health beauty": { category: "Bath & Beauty", subcategory: null },
  "consumer electronics": { category: "Electronics & Accessories", subcategory: null },
  "cell phones and accessories": { category: "Electronics & Accessories", subcategory: "Phones & Accessories" },
  "cell phones accessories": { category: "Electronics & Accessories", subcategory: "Phones & Accessories" },
  "jewelry and watches": { category: "Jewelry & Watches", subcategory: null },
  "jewelry watches": { category: "Jewelry & Watches", subcategory: null },
  "pet supplies": { category: "Pet Supplies", subcategory: null },
  "toys and hobbies": { category: "Toys & Games", subcategory: null },
  "toys hobbies": { category: "Toys & Games", subcategory: null },
  crafts: { category: "Craft Supplies & Tools", subcategory: null },
  books: { category: "Books, Movies & Music", subcategory: "Books" },
  "books and magazines": { category: "Books, Movies & Music", subcategory: "Books" },
  "books magazines": { category: "Books, Movies & Music", subcategory: "Books" },
  music: { category: "Books, Movies & Music", subcategory: "Music (CDs, Vinyl, etc.)" },
  "dvds and movies": { category: "Books, Movies & Music", subcategory: "Movies & TV" },
  "dvds movies": { category: "Books, Movies & Music", subcategory: "Movies & TV" },
  "video games and consoles": { category: "Books, Movies & Music", subcategory: "Video Games" },
  "video games consoles": { category: "Books, Movies & Music", subcategory: "Video Games" },
  baby: { category: "Baby & Kids", subcategory: null },
  "musical instruments and gear": { category: "Musical Instruments", subcategory: null },
  "musical instruments gear": { category: "Musical Instruments", subcategory: null },
  "cameras and photo": { category: "Electronics & Accessories", subcategory: "Cameras & Photo" },
  "cameras photo": { category: "Electronics & Accessories", subcategory: "Cameras & Photo" },
  "computers tablets and networking": { category: "Electronics & Accessories", subcategory: "Computers & Tablets" },
  "computers tablets networking": { category: "Electronics & Accessories", subcategory: "Computers & Tablets" },
  "business and industrial": { category: "Business & Industrial", subcategory: null },
  "business industrial": { category: "Business & Industrial", subcategory: null },
  "ebay motors": { category: "Vehicles & Parts", subcategory: null },
  antiques: { category: "Art & Collectibles", subcategory: "Vintage & Antiques" },
  art: { category: "Art & Collectibles", subcategory: null },
  collectibles: { category: "Art & Collectibles", subcategory: null },
  "coins and paper money": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "coins paper money": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  stamps: { category: "Art & Collectibles", subcategory: "Stamps" },
  "sports mem cards and fan shop": { category: "Art & Collectibles", subcategory: "Trading Cards" },
  "sports mem cards fan shop": { category: "Art & Collectibles", subcategory: "Trading Cards" },
  "entertainment memorabilia": { category: "Art & Collectibles", subcategory: "Memorabilia" },
  "pottery and glass": { category: "Art & Collectibles", subcategory: null },
  "pottery glass": { category: "Art & Collectibles", subcategory: null },
  "dolls and bears": { category: "Toys & Games", subcategory: "Dolls & Stuffed Animals" },
  "dolls bears": { category: "Toys & Games", subcategory: "Dolls & Stuffed Animals" },
  "tickets and experiences": { category: "Tickets & Experiences", subcategory: null },
  "tickets experiences": { category: "Tickets & Experiences", subcategory: null },
  "gift cards and coupons": { category: "Paper & Party Supplies", subcategory: "Gift Wrap & Packaging" },
  travel: { category: "Luggage & Travel", subcategory: "Travel Accessories" },
  "specialty services": { category: "Business & Industrial", subcategory: "Other Business & Industrial" },
  "everything else": { category: "Art & Collectibles", subcategory: "Other Art & Collectibles" },

  // ── Clothing, Shoes & Accessories ────────────────────────────────────
  "women s clothing": { category: "Clothing", subcategory: "Women's Clothing" },
  "womens clothing": { category: "Clothing", subcategory: "Women's Clothing" },
  "men s clothing": { category: "Clothing", subcategory: "Men's Clothing" },
  "mens clothing": { category: "Clothing", subcategory: "Men's Clothing" },
  "kids clothing": { category: "Clothing", subcategory: "Kids' Clothing" },
  "kid s clothing": { category: "Clothing", subcategory: "Kids' Clothing" },
  dresses: { category: "Clothing", subcategory: "Dresses & Skirts" },
  "tops and tees": { category: "Clothing", subcategory: "Tops & Tees" },
  "activewear": { category: "Clothing", subcategory: "Activewear" },
  "coats jackets and vests": { category: "Clothing", subcategory: "Jackets & Coats" },
  "coats jackets vests": { category: "Clothing", subcategory: "Jackets & Coats" },
  "sleepwear and robes": { category: "Clothing", subcategory: "Sleepwear & Loungewear" },
  "sleepwear robes": { category: "Clothing", subcategory: "Sleepwear & Loungewear" },
  "women s shoes": { category: "Shoes", subcategory: "Women's Shoes" },
  "womens shoes": { category: "Shoes", subcategory: "Women's Shoes" },
  "men s shoes": { category: "Shoes", subcategory: "Men's Shoes" },
  "mens shoes": { category: "Shoes", subcategory: "Men's Shoes" },
  "athletic shoes": { category: "Shoes", subcategory: "Athletic & Sneakers" },
  "women s bags and handbags": { category: "Bags & Purses", subcategory: "Handbags" },
  "womens bags handbags": { category: "Bags & Purses", subcategory: "Handbags" },
  "women s accessories": { category: "Accessories", subcategory: null },
  "womens accessories": { category: "Accessories", subcategory: null },
  "men s accessories": { category: "Accessories", subcategory: null },
  "mens accessories": { category: "Accessories", subcategory: null },
  hats: { category: "Accessories", subcategory: "Hats & Caps" },
  scarves: { category: "Accessories", subcategory: "Scarves & Wraps" },
  belts: { category: "Accessories", subcategory: "Belts" },
  sunglasses: { category: "Accessories", subcategory: "Sunglasses & Eyewear" },
  wallets: { category: "Bags & Purses", subcategory: "Wallets & Card Holders" },

  // ── Home & Garden ────────────────────────────────────────────────────
  "home decor": { category: "Home & Living", subcategory: "Home Decor" },
  "home décor": { category: "Home & Living", subcategory: "Home Decor" },
  bedding: { category: "Home & Living", subcategory: "Bedding" },
  "kitchen dining and bar": { category: "Home & Kitchen", subcategory: null },
  "kitchen dining bar": { category: "Home & Kitchen", subcategory: null },
  cookware: { category: "Home & Kitchen", subcategory: "Cookware & Bakeware" },
  "small kitchen appliances": { category: "Home & Kitchen", subcategory: "Small Appliances" },
  furniture: { category: "Furniture", subcategory: null },
  "living room furniture": { category: "Furniture", subcategory: "Living Room" },
  "bedroom furniture": { category: "Furniture", subcategory: "Bedroom" },
  "dining room furniture": { category: "Furniture", subcategory: "Dining Room" },
  "outdoor furniture": { category: "Furniture", subcategory: "Outdoor Furniture" },
  "yard garden and outdoor living": { category: "Home & Garden", subcategory: "Outdoor & Gardening" },
  "yard garden outdoor living": { category: "Home & Garden", subcategory: "Outdoor & Gardening" },
  "greeting cards and party supply": { category: "Paper & Party Supplies", subcategory: "Party Decorations" },
  "wedding supplies": { category: "Wedding", subcategory: "Decor & Centerpieces" },
  "bath accessories": { category: "Home & Living", subcategory: "Bathroom" },
  lighting: { category: "Home & Living", subcategory: "Lighting" },
  rugs: { category: "Furniture", subcategory: "Rugs & Carpets" },
  "storage and organization": { category: "Home & Living", subcategory: "Home Storage" },

  // ── Health & Beauty ──────────────────────────────────────────────────
  "skin care": { category: "Bath & Beauty", subcategory: "Skin Care" },
  "hair care and styling": { category: "Bath & Beauty", subcategory: "Hair Care" },
  "hair care styling": { category: "Bath & Beauty", subcategory: "Hair Care" },
  "makeup": { category: "Bath & Beauty", subcategory: "Makeup & Cosmetics" },
  fragrance: { category: "Bath & Beauty", subcategory: "Fragrances" },
  "nail care": { category: "Bath & Beauty", subcategory: "Nail Care" },
  "vitamins and lifestyle supplements": { category: "Health & Personal Care", subcategory: "Vitamins & Supplements" },
  "vitamins lifestyle supplements": { category: "Health & Personal Care", subcategory: "Vitamins & Supplements" },
  "oral care": { category: "Health & Personal Care", subcategory: "Oral Care" },

  // ── Jewelry & Watches ────────────────────────────────────────────────
  "fine jewelry": { category: "Jewelry & Watches", subcategory: "Fine Jewelry" },
  "fashion jewelry": { category: "Jewelry & Watches", subcategory: "Fashion Jewelry" },
  watches: { category: "Jewelry & Watches", subcategory: "Watches" },
  necklaces: { category: "Jewelry & Watches", subcategory: "Necklaces & Pendants" },
  bracelets: { category: "Jewelry & Watches", subcategory: "Bracelets" },
  earrings: { category: "Jewelry & Watches", subcategory: "Earrings" },
  rings: { category: "Jewelry & Watches", subcategory: "Rings" },

  // ── Electronics ──────────────────────────────────────────────────────
  "cell phones and smartphones": { category: "Electronics & Accessories", subcategory: "Phones & Accessories" },
  "cell phones smartphones": { category: "Electronics & Accessories", subcategory: "Phones & Accessories" },
  "phone cases covers and skins": { category: "Electronics & Accessories", subcategory: "Phones & Accessories" },
  "laptops and netbooks": { category: "Electronics & Accessories", subcategory: "Computers & Tablets" },
  "laptops netbooks": { category: "Electronics & Accessories", subcategory: "Computers & Tablets" },
  "tablets and ebook readers": { category: "Electronics & Accessories", subcategory: "Computers & Tablets" },
  "tablets ebook readers": { category: "Electronics & Accessories", subcategory: "Computers & Tablets" },
  "tv video and home audio": { category: "Electronics & Accessories", subcategory: "TV & Video" },
  "tv video home audio": { category: "Electronics & Accessories", subcategory: "TV & Video" },
  "headphones": { category: "Electronics & Accessories", subcategory: "Audio & Headphones" },
  "portable audio and headphones": { category: "Electronics & Accessories", subcategory: "Audio & Headphones" },
  "video games": { category: "Books, Movies & Music", subcategory: "Video Games" },
  "video game consoles": { category: "Electronics & Accessories", subcategory: "Gaming Consoles & Accessories" },
  "smart home": { category: "Electronics & Accessories", subcategory: "Smart Home" },
  "digital cameras": { category: "Electronics & Accessories", subcategory: "Cameras & Photo" },
  "camera lenses": { category: "Electronics & Accessories", subcategory: "Cameras & Photo" },

  // ── Sports & Outdoors ────────────────────────────────────────────────
  "camping and hiking": { category: "Sports & Outdoors", subcategory: "Camping & Hiking" },
  "camping hiking": { category: "Sports & Outdoors", subcategory: "Camping & Hiking" },
  "cycling": { category: "Sports & Outdoors", subcategory: "Cycling" },
  "fitness running and yoga": { category: "Sports & Outdoors", subcategory: "Fitness & Exercise" },
  "fitness running yoga": { category: "Sports & Outdoors", subcategory: "Fitness & Exercise" },
  "hunting": { category: "Sports & Outdoors", subcategory: "Hunting & Fishing" },
  "fishing": { category: "Sports & Outdoors", subcategory: "Hunting & Fishing" },
  "golf": { category: "Sports & Outdoors", subcategory: "Team Sports" },
  "team sports": { category: "Sports & Outdoors", subcategory: "Team Sports" },
  "outdoor sports": { category: "Sports & Outdoors", subcategory: "Outdoor Gear" },
  "winter sports": { category: "Sports & Outdoors", subcategory: "Winter Sports" },

  // ── Toys & Hobbies ───────────────────────────────────────────────────
  "action figures": { category: "Toys & Games", subcategory: "Action Figures & Collectibles" },
  "building toys": { category: "Toys & Games", subcategory: "Building & Construction" },
  "games": { category: "Toys & Games", subcategory: "Board Games & Puzzles" },
  "puzzles": { category: "Toys & Games", subcategory: "Board Games & Puzzles" },
  "stuffed animals": { category: "Toys & Games", subcategory: "Dolls & Stuffed Animals" },
  "model trains": { category: "Toys & Games", subcategory: "Other Toys & Games" },
  "radio control": { category: "Toys & Games", subcategory: "Outdoor Play" },

  // ── Pet Supplies ─────────────────────────────────────────────────────
  "dog supplies": { category: "Pet Supplies", subcategory: "Dog" },
  "cat supplies": { category: "Pet Supplies", subcategory: "Cat" },
  "fish and aquariums": { category: "Pet Supplies", subcategory: "Fish & Aquarium" },
  "fish aquariums": { category: "Pet Supplies", subcategory: "Fish & Aquarium" },
  "bird supplies": { category: "Pet Supplies", subcategory: "Bird" },
  "small animal supplies": { category: "Pet Supplies", subcategory: "Small Animal" },

  // ── Crafts ───────────────────────────────────────────────────────────
  "art supplies": { category: "Craft Supplies & Tools", subcategory: "Painting & Drawing Supplies" },
  "scrapbooking and paper crafts": { category: "Craft Supplies & Tools", subcategory: "Scrapbooking & Paper Craft" },
  "scrapbooking paper crafts": { category: "Craft Supplies & Tools", subcategory: "Scrapbooking & Paper Craft" },
  "sewing": { category: "Craft Supplies & Tools", subcategory: "Fabric & Sewing" },
  "knitting and crochet": { category: "Craft Supplies & Tools", subcategory: "Yarn & Knitting" },
  "knitting crochet": { category: "Craft Supplies & Tools", subcategory: "Yarn & Knitting" },
  "beads and jewelry making": { category: "Craft Supplies & Tools", subcategory: "Beading & Jewelry Making" },
  "beads jewelry making": { category: "Craft Supplies & Tools", subcategory: "Beading & Jewelry Making" },

  // ── Collectibles (existing + expanded) ───────────────────────────────
  "coins us": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "coins world": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "coins: us": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "coins: world": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "paper money us": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "paper money world": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  bullion: { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  exonumia: { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "stamps united states": { category: "Art & Collectibles", subcategory: "Stamps" },
  "stamps worldwide": { category: "Art & Collectibles", subcategory: "Stamps" },
  "sports trading cards": { category: "Art & Collectibles", subcategory: "Trading Cards" },
  "non sport trading cards": { category: "Art & Collectibles", subcategory: "Trading Cards" },
  "trading cards": { category: "Art & Collectibles", subcategory: "Trading Cards" },
  comics: { category: "Books, Movies & Music", subcategory: "Comics & Graphic Novels" },
  "comic books": { category: "Books, Movies & Music", subcategory: "Comics & Graphic Novels" },
  autographs: { category: "Art & Collectibles", subcategory: "Memorabilia" },
  "music memorabilia": { category: "Art & Collectibles", subcategory: "Memorabilia" },
  "movie memorabilia": { category: "Art & Collectibles", subcategory: "Memorabilia" },

  // ── Baby ─────────────────────────────────────────────────────────────
  "baby clothing": { category: "Baby & Kids", subcategory: "Baby Clothing" },
  "baby gear": { category: "Baby & Kids", subcategory: "Baby Gear & Nursery" },
  "strollers": { category: "Baby & Kids", subcategory: "Strollers & Carriers" },
  "toys for baby": { category: "Baby & Kids", subcategory: "Toys for Baby & Toddler" },

  // ── Musical Instruments ──────────────────────────────────────────────
  guitars: { category: "Musical Instruments", subcategory: "Guitars & Bass" },
  "guitar bass": { category: "Musical Instruments", subcategory: "Guitars & Bass" },
  "pro audio equipment": { category: "Musical Instruments", subcategory: "Pro Audio & Recording" },
  "keyboards and pianos": { category: "Musical Instruments", subcategory: "Keyboards & Pianos" },
  "keyboards pianos": { category: "Musical Instruments", subcategory: "Keyboards & Pianos" },
  "drums and percussion": { category: "Musical Instruments", subcategory: "Drums & Percussion" },
  "drums percussion": { category: "Musical Instruments", subcategory: "Drums & Percussion" },

  // ── Business & Industrial / Motors ───────────────────────────────────
  "office supplies": { category: "Office & School Supplies", subcategory: "Office Supplies" },
  "industrial supplies": { category: "Business & Industrial", subcategory: "Industrial Supplies" },
  "healthcare lab and dental": { category: "Business & Industrial", subcategory: "Healthcare & Lab" },
  "healthcare lab dental": { category: "Business & Industrial", subcategory: "Healthcare & Lab" },
  "car and truck parts and accessories": { category: "Vehicles & Parts", subcategory: "Car & Truck Parts" },
  "car truck parts accessories": { category: "Vehicles & Parts", subcategory: "Car & Truck Parts" },
  "motorcycle parts": { category: "Vehicles & Parts", subcategory: "Motorcycle & ATV" },
  "parts and accessories": { category: "Vehicles & Parts", subcategory: "Car & Truck Parts" },
  "parts accessories": { category: "Vehicles & Parts", subcategory: "Car & Truck Parts" },

  // ── Tools ────────────────────────────────────────────────────────────
  "hand tools": { category: "Tools & Home Improvement", subcategory: "Hand Tools" },
  "power tools": { category: "Tools & Home Improvement", subcategory: "Power Tools" },
  "hardware": { category: "Tools & Home Improvement", subcategory: "Hardware" },
  "electrical supplies": { category: "Tools & Home Improvement", subcategory: "Electrical" },
  "plumbing fixtures": { category: "Tools & Home Improvement", subcategory: "Plumbing" },
  "paint supplies": { category: "Tools & Home Improvement", subcategory: "Paint & Supplies" },

  // ── Luggage ──────────────────────────────────────────────────────────
  "luggage": { category: "Luggage & Travel", subcategory: "Suitcases & Luggage" },
  "travel accessories": { category: "Luggage & Travel", subcategory: "Travel Accessories" },

  // ── Tickets ──────────────────────────────────────────────────────────
  "concert tickets": { category: "Tickets & Experiences", subcategory: "Event Tickets" },
  "sports tickets": { category: "Tickets & Experiences", subcategory: "Event Tickets" },
  "theater tickets": { category: "Tickets & Experiences", subcategory: "Event Tickets" },
};
