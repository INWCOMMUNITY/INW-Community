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

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPANDED EBAY CATEGORY ALIASES (Based on eBay's Full Category Tree)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Additional Top-Level eBay Roots (34 total) ─────────────────────────
  "real estate": { category: "Business & Industrial", subcategory: null },
  "gift certificates": { category: "Paper & Party Supplies", subcategory: "Gift Wrap & Packaging" },

  // ── Antiques ───────────────────────────────────────────────────────────
  "architectural and garden": { category: "Home & Garden", subcategory: "Outdoor & Gardening" },
  "architectural garden": { category: "Home & Garden", subcategory: "Outdoor & Gardening" },
  "asian antiques": { category: "Art & Collectibles", subcategory: "Vintage & Antiques" },
  "decorative arts": { category: "Art & Collectibles", subcategory: "Vintage & Antiques" },
  "ethnographic": { category: "Art & Collectibles", subcategory: "Vintage & Antiques" },
  "furniture antique": { category: "Furniture", subcategory: "Vintage & Antique" },
  "antique furniture": { category: "Furniture", subcategory: "Vintage & Antique" },
  "maps atlases globes": { category: "Art & Collectibles", subcategory: "Maps & Atlases" },
  "maps atlases and globes": { category: "Art & Collectibles", subcategory: "Maps & Atlases" },
  "maritime": { category: "Art & Collectibles", subcategory: "Maritime & Nautical" },
  "primitives": { category: "Art & Collectibles", subcategory: "Vintage & Antiques" },
  "rugs and carpets": { category: "Furniture", subcategory: "Rugs & Carpets" },
  "rugs carpets": { category: "Furniture", subcategory: "Rugs & Carpets" },
  "science and medicine antique": { category: "Art & Collectibles", subcategory: "Scientific Antiques" },
  "silver": { category: "Art & Collectibles", subcategory: "Silver & Silverplate" },
  "textiles linens": { category: "Home & Living", subcategory: "Linens & Textiles" },
  "textiles and linens": { category: "Home & Living", subcategory: "Linens & Textiles" },

  // ── Art ────────────────────────────────────────────────────────────────
  "art from dealers and resellers": { category: "Art & Collectibles", subcategory: null },
  "art from dealers resellers": { category: "Art & Collectibles", subcategory: null },
  "direct from the artist": { category: "Art & Collectibles", subcategory: null },
  "art photographs": { category: "Art & Collectibles", subcategory: "Photography" },
  "art prints": { category: "Art & Collectibles", subcategory: "Paintings & Prints" },
  "drawings": { category: "Art & Collectibles", subcategory: "Drawing & Illustration" },
  "folk art": { category: "Art & Collectibles", subcategory: "Folk Art" },
  "mixed media and collage": { category: "Art & Collectibles", subcategory: "Mixed Media & Collage" },
  "mixed media collage": { category: "Art & Collectibles", subcategory: "Mixed Media & Collage" },
  "paintings": { category: "Art & Collectibles", subcategory: "Paintings & Prints" },
  "posters": { category: "Art & Collectibles", subcategory: "Posters" },
  "sculpture and carvings": { category: "Art & Collectibles", subcategory: "Sculpture & Statues" },
  "sculpture carvings": { category: "Art & Collectibles", subcategory: "Sculpture & Statues" },
  "self representing artists": { category: "Art & Collectibles", subcategory: null },

  // ── Collectibles Expanded ──────────────────────────────────────────────
  "advertising": { category: "Art & Collectibles", subcategory: "Advertising Collectibles" },
  "animals": { category: "Art & Collectibles", subcategory: "Animal Collectibles" },
  "animation art and characters": { category: "Art & Collectibles", subcategory: "Animation Art" },
  "animation art characters": { category: "Art & Collectibles", subcategory: "Animation Art" },
  "arcade jukeboxes and pinball": { category: "Art & Collectibles", subcategory: "Arcade & Gaming" },
  "arcade jukeboxes pinball": { category: "Art & Collectibles", subcategory: "Arcade & Gaming" },
  "barware": { category: "Home & Kitchen", subcategory: "Bar & Barware" },
  "bottles and insulators": { category: "Art & Collectibles", subcategory: "Bottles & Insulators" },
  "bottles insulators": { category: "Art & Collectibles", subcategory: "Bottles & Insulators" },
  "breweriana beer": { category: "Art & Collectibles", subcategory: "Breweriana" },
  "casino": { category: "Art & Collectibles", subcategory: "Casino Collectibles" },
  "clocks": { category: "Home & Living", subcategory: "Clocks" },
  "comics collectible": { category: "Books, Movies & Music", subcategory: "Comics & Graphic Novels" },
  "cultures and ethnicities": { category: "Art & Collectibles", subcategory: "Cultural Collectibles" },
  "cultures ethnicities": { category: "Art & Collectibles", subcategory: "Cultural Collectibles" },
  "decorative collectibles": { category: "Art & Collectibles", subcategory: "Decorative Collectibles" },
  "disneyana": { category: "Art & Collectibles", subcategory: "Disney Collectibles" },
  "disney": { category: "Art & Collectibles", subcategory: "Disney Collectibles" },
  "fantasy mythical and magic": { category: "Art & Collectibles", subcategory: "Fantasy Collectibles" },
  "fantasy mythical magic": { category: "Art & Collectibles", subcategory: "Fantasy Collectibles" },
  "historical memorabilia": { category: "Art & Collectibles", subcategory: "Historical Memorabilia" },
  "holiday and seasonal": { category: "Paper & Party Supplies", subcategory: "Holiday Decorations" },
  "holiday seasonal": { category: "Paper & Party Supplies", subcategory: "Holiday Decorations" },
  "christmas": { category: "Paper & Party Supplies", subcategory: "Holiday Decorations" },
  "halloween": { category: "Paper & Party Supplies", subcategory: "Holiday Decorations" },
  "kitchen and home": { category: "Home & Kitchen", subcategory: null },
  "kitchen home": { category: "Home & Kitchen", subcategory: null },
  "knives swords and blades": { category: "Art & Collectibles", subcategory: "Knives & Swords" },
  "knives swords blades": { category: "Art & Collectibles", subcategory: "Knives & Swords" },
  "lamps lighting": { category: "Home & Living", subcategory: "Lighting" },
  "lamps and lighting": { category: "Home & Living", subcategory: "Lighting" },
  "militaria": { category: "Art & Collectibles", subcategory: "Military Collectibles" },
  "military": { category: "Art & Collectibles", subcategory: "Military Collectibles" },
  "pens and writing instruments": { category: "Office & School Supplies", subcategory: "Pens & Writing" },
  "pens writing instruments": { category: "Office & School Supplies", subcategory: "Pens & Writing" },
  "pez keychains promo glasses": { category: "Art & Collectibles", subcategory: "Promotional Collectibles" },
  "photographic images": { category: "Art & Collectibles", subcategory: "Photography" },
  "pinbacks bobbles lunchboxes": { category: "Art & Collectibles", subcategory: "Vintage Collectibles" },
  "postcards and paper": { category: "Art & Collectibles", subcategory: "Postcards" },
  "postcards paper": { category: "Art & Collectibles", subcategory: "Postcards" },
  "radio phonograph tv phone": { category: "Art & Collectibles", subcategory: "Vintage Electronics" },
  "religion and spirituality": { category: "Home & Living", subcategory: "Spirituality & Religion" },
  "religion spirituality": { category: "Home & Living", subcategory: "Spirituality & Religion" },
  "rocks fossils and minerals": { category: "Art & Collectibles", subcategory: "Rocks & Minerals" },
  "rocks fossils minerals": { category: "Art & Collectibles", subcategory: "Rocks & Minerals" },
  "science fiction and horror": { category: "Art & Collectibles", subcategory: "Sci-Fi & Horror" },
  "science fiction horror": { category: "Art & Collectibles", subcategory: "Sci-Fi & Horror" },
  "tobacciana": { category: "Art & Collectibles", subcategory: "Tobacciana" },
  "tools hardware locks": { category: "Tools & Home Improvement", subcategory: null },
  "tools hardware and locks": { category: "Tools & Home Improvement", subcategory: null },
  "transportation": { category: "Art & Collectibles", subcategory: "Transportation Collectibles" },
  "vanity perfume and shaving": { category: "Bath & Beauty", subcategory: "Vintage Beauty" },
  "vanity perfume shaving": { category: "Bath & Beauty", subcategory: "Vintage Beauty" },
  "vintage sewing": { category: "Craft Supplies & Tools", subcategory: "Vintage Sewing" },
  "wholesale lots": { category: "Business & Industrial", subcategory: null },

  // ── Additional Clothing Categories ─────────────────────────────────────
  "intimates and sleep": { category: "Clothing", subcategory: "Intimates & Sleepwear" },
  "intimates sleep": { category: "Clothing", subcategory: "Intimates & Sleepwear" },
  "maternity": { category: "Clothing", subcategory: "Maternity" },
  "vintage clothing": { category: "Clothing", subcategory: "Vintage" },
  "uniforms and work clothing": { category: "Clothing", subcategory: "Uniforms & Work Clothing" },
  "uniforms work clothing": { category: "Clothing", subcategory: "Uniforms & Work Clothing" },
  "costumes": { category: "Clothing", subcategory: "Costumes" },
  "dancewear": { category: "Clothing", subcategory: "Dancewear" },
  "world and traditional clothing": { category: "Clothing", subcategory: "Cultural & Traditional" },
  "world traditional clothing": { category: "Clothing", subcategory: "Cultural & Traditional" },
  jeans: { category: "Clothing", subcategory: "Jeans" },
  shorts: { category: "Clothing", subcategory: "Shorts" },
  skirts: { category: "Clothing", subcategory: "Dresses & Skirts" },
  sweaters: { category: "Clothing", subcategory: "Sweaters" },
  swimwear: { category: "Clothing", subcategory: "Swimwear" },
  suits: { category: "Clothing", subcategory: "Suits & Blazers" },
  blazers: { category: "Clothing", subcategory: "Suits & Blazers" },

  // ── Additional Shoe Categories ─────────────────────────────────────────
  "boots": { category: "Shoes", subcategory: "Boots" },
  "sandals": { category: "Shoes", subcategory: "Sandals" },
  "flats": { category: "Shoes", subcategory: "Flats" },
  "heels": { category: "Shoes", subcategory: "Heels" },
  "loafers": { category: "Shoes", subcategory: "Loafers & Slip-Ons" },
  "oxfords": { category: "Shoes", subcategory: "Oxfords" },
  "slippers": { category: "Shoes", subcategory: "Slippers" },
  "kids shoes": { category: "Shoes", subcategory: "Kids' Shoes" },
  "kid s shoes": { category: "Shoes", subcategory: "Kids' Shoes" },

  // ── Additional Electronics Categories ──────────────────────────────────
  "wearable technology": { category: "Electronics & Accessories", subcategory: "Wearables" },
  "smartwatches": { category: "Electronics & Accessories", subcategory: "Wearables" },
  "fitness trackers": { category: "Electronics & Accessories", subcategory: "Wearables" },
  "drones": { category: "Electronics & Accessories", subcategory: "Drones & RC" },
  "surveillance cameras": { category: "Electronics & Accessories", subcategory: "Security & Surveillance" },
  "home security": { category: "Electronics & Accessories", subcategory: "Security & Surveillance" },
  "virtual reality": { category: "Electronics & Accessories", subcategory: "VR & AR" },
  "vr headsets": { category: "Electronics & Accessories", subcategory: "VR & AR" },
  "batteries and chargers": { category: "Electronics & Accessories", subcategory: "Batteries & Chargers" },
  "batteries chargers": { category: "Electronics & Accessories", subcategory: "Batteries & Chargers" },
  "cables and connectors": { category: "Electronics & Accessories", subcategory: "Cables & Connectors" },
  "cables connectors": { category: "Electronics & Accessories", subcategory: "Cables & Connectors" },
  "printers scanners supplies": { category: "Electronics & Accessories", subcategory: "Printers & Scanners" },
  "printers scanners and supplies": { category: "Electronics & Accessories", subcategory: "Printers & Scanners" },

  // ── Additional Home & Garden Categories ────────────────────────────────
  "candles": { category: "Home & Living", subcategory: "Candles & Holders" },
  "candle holders": { category: "Home & Living", subcategory: "Candles & Holders" },
  "clocks vintage": { category: "Home & Living", subcategory: "Clocks" },
  "curtains drapes valances": { category: "Home & Living", subcategory: "Curtains & Window Treatments" },
  "curtains drapes and valances": { category: "Home & Living", subcategory: "Curtains & Window Treatments" },
  "decorative pillows": { category: "Home & Living", subcategory: "Pillows" },
  "throw pillows": { category: "Home & Living", subcategory: "Pillows" },
  "accent pillows": { category: "Home & Living", subcategory: "Pillows" },
  "throws blankets": { category: "Home & Living", subcategory: "Blankets & Throws" },
  "throws and blankets": { category: "Home & Living", subcategory: "Blankets & Throws" },
  "mirrors": { category: "Home & Living", subcategory: "Mirrors" },
  "picture frames": { category: "Home & Living", subcategory: "Frames & Displays" },
  "photo frames": { category: "Home & Living", subcategory: "Frames & Displays" },
  "vases": { category: "Home & Living", subcategory: "Vases" },
  "wall art": { category: "Home & Living", subcategory: "Wall Decor" },
  "wall decor": { category: "Home & Living", subcategory: "Wall Decor" },
  "tapestries": { category: "Home & Living", subcategory: "Wall Decor" },
  "baskets": { category: "Home & Living", subcategory: "Home Storage" },
  "bins and baskets": { category: "Home & Living", subcategory: "Home Storage" },
  "bins baskets": { category: "Home & Living", subcategory: "Home Storage" },
  "garden planters": { category: "Home & Garden", subcategory: "Outdoor & Gardening" },
  "planters": { category: "Home & Garden", subcategory: "Outdoor & Gardening" },
  "pots": { category: "Home & Garden", subcategory: "Outdoor & Gardening" },
  "garden decor": { category: "Home & Garden", subcategory: "Outdoor & Gardening" },
  "fountains": { category: "Home & Garden", subcategory: "Outdoor & Gardening" },
  "birdfeeders": { category: "Home & Garden", subcategory: "Outdoor & Gardening" },
  "bird feeders": { category: "Home & Garden", subcategory: "Outdoor & Gardening" },
  "pools spas": { category: "Home & Garden", subcategory: "Outdoor & Gardening" },
  "pools and spas": { category: "Home & Garden", subcategory: "Outdoor & Gardening" },
  "grills and outdoor cooking": { category: "Home & Garden", subcategory: "Grilling & BBQ" },
  "grills outdoor cooking": { category: "Home & Garden", subcategory: "Grilling & BBQ" },
  "patio furniture": { category: "Furniture", subcategory: "Outdoor Furniture" },

  // ── Additional Kitchen Categories ──────────────────────────────────────
  "bakeware": { category: "Home & Kitchen", subcategory: "Cookware & Bakeware" },
  "coffee and tea": { category: "Home & Kitchen", subcategory: "Coffee & Tea" },
  "coffee tea": { category: "Home & Kitchen", subcategory: "Coffee & Tea" },
  "dinnerware serving dishes": { category: "Home & Kitchen", subcategory: "Dinnerware" },
  "dinnerware and serving dishes": { category: "Home & Kitchen", subcategory: "Dinnerware" },
  "flatware and silverware": { category: "Home & Kitchen", subcategory: "Flatware" },
  "flatware silverware": { category: "Home & Kitchen", subcategory: "Flatware" },
  "glassware drinkware": { category: "Home & Kitchen", subcategory: "Drinkware" },
  "glassware and drinkware": { category: "Home & Kitchen", subcategory: "Drinkware" },
  "kitchen tools gadgets": { category: "Home & Kitchen", subcategory: "Kitchen Tools" },
  "kitchen tools and gadgets": { category: "Home & Kitchen", subcategory: "Kitchen Tools" },
  "kitchen utensils": { category: "Home & Kitchen", subcategory: "Kitchen Tools" },
  "serveware": { category: "Home & Kitchen", subcategory: "Dining & Serving" },
  "serving dishes": { category: "Home & Kitchen", subcategory: "Dining & Serving" },
  "food storage containers": { category: "Home & Kitchen", subcategory: "Food Storage" },

  // ── Additional Jewelry Categories ──────────────────────────────────────
  "anklets": { category: "Jewelry & Watches", subcategory: "Anklets" },
  "body jewelry": { category: "Jewelry & Watches", subcategory: "Body Jewelry" },
  "brooches pins": { category: "Jewelry & Watches", subcategory: "Brooches" },
  "brooches and pins": { category: "Jewelry & Watches", subcategory: "Brooches" },
  "charms": { category: "Jewelry & Watches", subcategory: "Charms" },
  "charm bracelets": { category: "Jewelry & Watches", subcategory: "Bracelets" },
  "cufflinks": { category: "Jewelry & Watches", subcategory: "Cufflinks" },
  "cuff links": { category: "Jewelry & Watches", subcategory: "Cufflinks" },
  "engagement wedding": { category: "Jewelry & Watches", subcategory: "Engagement & Wedding" },
  "engagement and wedding": { category: "Jewelry & Watches", subcategory: "Engagement & Wedding" },
  "ethnic regional tribal": { category: "Jewelry & Watches", subcategory: "Ethnic Jewelry" },
  "ethnic regional and tribal": { category: "Jewelry & Watches", subcategory: "Ethnic Jewelry" },
  "hair jewelry": { category: "Jewelry & Watches", subcategory: "Hair Jewelry" },
  "jewelry boxes organizers": { category: "Jewelry & Watches", subcategory: "Jewelry Boxes" },
  "jewelry boxes and organizers": { category: "Jewelry & Watches", subcategory: "Jewelry Boxes" },
  "loose diamonds gemstones": { category: "Jewelry & Watches", subcategory: "Loose Gemstones" },
  "loose diamonds and gemstones": { category: "Jewelry & Watches", subcategory: "Loose Gemstones" },
  "men s jewelry": { category: "Jewelry & Watches", subcategory: "Men's Jewelry" },
  "mens jewelry": { category: "Jewelry & Watches", subcategory: "Men's Jewelry" },
  "vintage antique jewelry": { category: "Jewelry & Watches", subcategory: "Vintage Jewelry" },
  "vintage and antique jewelry": { category: "Jewelry & Watches", subcategory: "Vintage Jewelry" },
  "watch accessories": { category: "Jewelry & Watches", subcategory: "Watch Accessories" },
  "watch bands": { category: "Jewelry & Watches", subcategory: "Watch Accessories" },
  "wristwatches": { category: "Jewelry & Watches", subcategory: "Watches" },
  "pocket watches": { category: "Jewelry & Watches", subcategory: "Watches" },

  // ── Additional Sports Categories ───────────────────────────────────────
  "baseball softball": { category: "Sports & Outdoors", subcategory: "Team Sports" },
  "baseball and softball": { category: "Sports & Outdoors", subcategory: "Team Sports" },
  "basketball": { category: "Sports & Outdoors", subcategory: "Team Sports" },
  "boxing martial arts mma": { category: "Sports & Outdoors", subcategory: "Combat Sports" },
  "boxing martial arts and mma": { category: "Sports & Outdoors", subcategory: "Combat Sports" },
  "exercise fitness": { category: "Sports & Outdoors", subcategory: "Fitness & Exercise" },
  "exercise and fitness": { category: "Sports & Outdoors", subcategory: "Fitness & Exercise" },
  "football": { category: "Sports & Outdoors", subcategory: "Team Sports" },
  "soccer": { category: "Sports & Outdoors", subcategory: "Team Sports" },
  "hockey": { category: "Sports & Outdoors", subcategory: "Team Sports" },
  "tennis racquet sports": { category: "Sports & Outdoors", subcategory: "Racquet Sports" },
  "tennis and racquet sports": { category: "Sports & Outdoors", subcategory: "Racquet Sports" },
  "water sports": { category: "Sports & Outdoors", subcategory: "Water Sports" },
  "skiing snowboarding": { category: "Sports & Outdoors", subcategory: "Winter Sports" },
  "skiing and snowboarding": { category: "Sports & Outdoors", subcategory: "Winter Sports" },
  "skateboarding": { category: "Sports & Outdoors", subcategory: "Action Sports" },
  "surfing": { category: "Sports & Outdoors", subcategory: "Water Sports" },
  "equestrian": { category: "Sports & Outdoors", subcategory: "Equestrian" },

  // ── Additional Baby & Kids Categories ──────────────────────────────────
  "baby safety health": { category: "Baby & Kids", subcategory: "Baby Safety" },
  "baby safety and health": { category: "Baby & Kids", subcategory: "Baby Safety" },
  "baby feeding": { category: "Baby & Kids", subcategory: "Baby Feeding" },
  "bathing and grooming": { category: "Baby & Kids", subcategory: "Baby Bath & Grooming" },
  "bathing grooming": { category: "Baby & Kids", subcategory: "Baby Bath & Grooming" },
  "car safety seats": { category: "Baby & Kids", subcategory: "Car Seats" },
  "diapering": { category: "Baby & Kids", subcategory: "Diapering" },
  "diapers": { category: "Baby & Kids", subcategory: "Diapering" },
  "nursery bedding": { category: "Baby & Kids", subcategory: "Nursery Bedding" },
  "nursery decor": { category: "Baby & Kids", subcategory: "Nursery Decor" },
  "nursery furniture": { category: "Baby & Kids", subcategory: "Nursery Furniture" },

  // ── Additional Craft Categories ────────────────────────────────────────
  "cross stitch": { category: "Craft Supplies & Tools", subcategory: "Embroidery & Cross Stitch" },
  "embroidery": { category: "Craft Supplies & Tools", subcategory: "Embroidery & Cross Stitch" },
  "crocheting": { category: "Craft Supplies & Tools", subcategory: "Yarn & Knitting" },
  "fabric": { category: "Craft Supplies & Tools", subcategory: "Fabric & Sewing" },
  "quilting": { category: "Craft Supplies & Tools", subcategory: "Quilting" },
  "needle felting": { category: "Craft Supplies & Tools", subcategory: "Felting" },
  "stamping embossing": { category: "Craft Supplies & Tools", subcategory: "Stamping & Embossing" },
  "stamping and embossing": { category: "Craft Supplies & Tools", subcategory: "Stamping & Embossing" },
  "leathercraft": { category: "Craft Supplies & Tools", subcategory: "Leather Craft" },
  "ceramics and pottery": { category: "Craft Supplies & Tools", subcategory: "Ceramics & Pottery" },
  "ceramics pottery": { category: "Craft Supplies & Tools", subcategory: "Ceramics & Pottery" },
  "glass art supplies": { category: "Craft Supplies & Tools", subcategory: "Glass Art" },
  "mosaic": { category: "Craft Supplies & Tools", subcategory: "Mosaics" },
  "woodworking": { category: "Craft Supplies & Tools", subcategory: "Woodworking" },
  "candle and soap making": { category: "Craft Supplies & Tools", subcategory: "Candle & Soap Making" },
  "candle soap making": { category: "Craft Supplies & Tools", subcategory: "Candle & Soap Making" },
};
