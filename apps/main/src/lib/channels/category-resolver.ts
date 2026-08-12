import { STORE_CATEGORIES } from "@/lib/store-categories";
import type { ChannelProvider } from "./types";
import {
  EBAY_CATEGORY_ALIASES,
  ebayCategoryPathCandidates,
  ebayCategoryPathCandidatesWithMeta,
  splitEbayCategoryPath,
  normalizeEbayLabel,
  aliasSpecificityScore,
  type EbayPathCandidate,
} from "./ebay-category-aliases";
import { getEtsyTaxonomyName } from "./etsy/mapping";

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

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPANDED ETSY CATEGORY ALIASES (Based on Etsy's Official Category List)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Body Jewelry Types ──
  barbells: { category: "Jewelry & Watches", subcategory: "Body Jewelry" },
  "belly chains": { category: "Jewelry & Watches", subcategory: "Body Jewelry" },
  "belly rings": { category: "Jewelry & Watches", subcategory: "Body Jewelry" },
  bindis: { category: "Jewelry & Watches", subcategory: "Body Jewelry" },
  "lip rings": { category: "Jewelry & Watches", subcategory: "Body Jewelry" },
  "nipple jewelry": { category: "Jewelry & Watches", subcategory: "Body Jewelry" },
  "nose rings": { category: "Jewelry & Watches", subcategory: "Body Jewelry" },
  "nose rings & studs": { category: "Jewelry & Watches", subcategory: "Body Jewelry" },
  "toe rings": { category: "Jewelry & Watches", subcategory: "Body Jewelry" },
  "pinchers & spirals": { category: "Jewelry & Watches", subcategory: "Body Jewelry" },
  "shoulder jewelry": { category: "Jewelry & Watches", subcategory: "Body Jewelry" },
  "arm bands": { category: "Jewelry & Watches", subcategory: "Body Jewelry" },

  // ── Earring Types ──
  "chandelier earrings": { category: "Jewelry & Watches", subcategory: "Earrings" },
  "clip-on earrings": { category: "Jewelry & Watches", subcategory: "Earrings" },
  "cluster earrings": { category: "Jewelry & Watches", subcategory: "Earrings" },
  "cuff & wrap earrings": { category: "Jewelry & Watches", subcategory: "Earrings" },
  "dangle & drop earrings": { category: "Jewelry & Watches", subcategory: "Earrings" },
  chandbalis: { category: "Jewelry & Watches", subcategory: "Earrings" },
  jhumkas: { category: "Jewelry & Watches", subcategory: "Earrings" },
  "ear jackets & climbers": { category: "Jewelry & Watches", subcategory: "Earrings" },
  "ear climbers": { category: "Jewelry & Watches", subcategory: "Earrings" },
  "ear jackets": { category: "Jewelry & Watches", subcategory: "Earrings" },
  "ear weights": { category: "Jewelry & Watches", subcategory: "Earrings" },
  "gauge & plug earrings": { category: "Jewelry & Watches", subcategory: "Earrings" },
  "hoop earrings": { category: "Jewelry & Watches", subcategory: "Earrings" },
  "kaan chains": { category: "Jewelry & Watches", subcategory: "Earrings" },
  "screw back earrings": { category: "Jewelry & Watches", subcategory: "Earrings" },
  "stud earrings": { category: "Jewelry & Watches", subcategory: "Earrings" },
  studs: { category: "Jewelry & Watches", subcategory: "Earrings" },
  "threader earrings": { category: "Jewelry & Watches", subcategory: "Earrings" },

  // ── Bracelet Types ──
  bangles: { category: "Jewelry & Watches", subcategory: "Bracelets" },
  "bridal churas": { category: "Jewelry & Watches", subcategory: "Bracelets" },
  "beaded bracelets": { category: "Jewelry & Watches", subcategory: "Bracelets" },
  "chain & link bracelets": { category: "Jewelry & Watches", subcategory: "Bracelets" },
  "cuff bracelets": { category: "Jewelry & Watches", subcategory: "Bracelets" },
  "hand chains": { category: "Jewelry & Watches", subcategory: "Bracelets" },
  "id & medical bracelets": { category: "Jewelry & Watches", subcategory: "Bracelets" },
  "medical bracelets": { category: "Jewelry & Watches", subcategory: "Bracelets" },
  "friendship bracelets": { category: "Jewelry & Watches", subcategory: "Bracelets" },
  "charm bracelets": { category: "Jewelry & Watches", subcategory: "Bracelets" },

  // ── Necklace Types ──
  "pendant necklaces": { category: "Jewelry & Watches", subcategory: "Necklaces & Pendants" },
  "choker necklaces": { category: "Jewelry & Watches", subcategory: "Necklaces & Pendants" },
  chokers: { category: "Jewelry & Watches", subcategory: "Necklaces & Pendants" },
  "collar necklaces": { category: "Jewelry & Watches", subcategory: "Necklaces & Pendants" },
  "lariat & y necklaces": { category: "Jewelry & Watches", subcategory: "Necklaces & Pendants" },
  "multi-strand necklaces": { category: "Jewelry & Watches", subcategory: "Necklaces & Pendants" },
  chains: { category: "Jewelry & Watches", subcategory: "Necklaces & Pendants" },

  // ── Ring Types ──
  "wedding bands": { category: "Jewelry & Watches", subcategory: "Rings" },
  "engagement rings": { category: "Jewelry & Watches", subcategory: "Rings" },
  "signet rings": { category: "Jewelry & Watches", subcategory: "Rings" },
  "statement rings": { category: "Jewelry & Watches", subcategory: "Rings" },
  "stackable rings": { category: "Jewelry & Watches", subcategory: "Rings" },

  // ── Other Jewelry ──
  "cremation & memorial jewelry": { category: "Jewelry & Watches", subcategory: "Memorial Jewelry" },
  "memorial jewelry": { category: "Jewelry & Watches", subcategory: "Memorial Jewelry" },
  "jewelry sets": { category: "Jewelry & Watches", subcategory: "Jewelry Sets" },
  "jewelry storage": { category: "Jewelry & Watches", subcategory: "Jewelry Boxes" },
  "jewelry boxes": { category: "Jewelry & Watches", subcategory: "Jewelry Boxes" },
  "smart jewelry": { category: "Jewelry & Watches", subcategory: "Watches" },
  "cuff links & tie clips": { category: "Jewelry & Watches", subcategory: "Cufflinks" },
  "cuff links": { category: "Jewelry & Watches", subcategory: "Cufflinks" },
  cufflinks: { category: "Jewelry & Watches", subcategory: "Cufflinks" },
  "tie clips & tacks": { category: "Jewelry & Watches", subcategory: "Tie Accessories" },
  "shirt studs": { category: "Jewelry & Watches", subcategory: "Cufflinks" },
  "brooches, pins & clips": { category: "Jewelry & Watches", subcategory: "Brooches" },

  // ── Indian Ethnic Clothing ──
  "indian ethnic clothing": { category: "Clothing", subcategory: "Cultural & Traditional" },
  saree: { category: "Clothing", subcategory: "Cultural & Traditional" },
  sarees: { category: "Clothing", subcategory: "Cultural & Traditional" },
  sari: { category: "Clothing", subcategory: "Cultural & Traditional" },
  saris: { category: "Clothing", subcategory: "Cultural & Traditional" },
  kurta: { category: "Clothing", subcategory: "Cultural & Traditional" },
  kurtas: { category: "Clothing", subcategory: "Cultural & Traditional" },
  lehenga: { category: "Clothing", subcategory: "Cultural & Traditional" },
  salwar: { category: "Clothing", subcategory: "Cultural & Traditional" },
  "salwar kameez": { category: "Clothing", subcategory: "Cultural & Traditional" },
  dupatta: { category: "Clothing", subcategory: "Cultural & Traditional" },
  anarkali: { category: "Clothing", subcategory: "Cultural & Traditional" },
  churidar: { category: "Clothing", subcategory: "Cultural & Traditional" },
  sherwani: { category: "Clothing", subcategory: "Cultural & Traditional" },

  // ── Gender-Neutral Clothing ──
  "gender-neutral adult clothing": { category: "Clothing", subcategory: "Unisex" },
  "gender-neutral kids' clothing": { category: "Baby & Kids", subcategory: "Kids' Clothing" },
  "unisex clothing": { category: "Clothing", subcategory: "Unisex" },
  unisex: { category: "Clothing", subcategory: "Unisex" },

  // ── Baby & Kids Clothing Expanded ──
  "baby boys' clothing": { category: "Baby & Kids", subcategory: "Baby Clothing" },
  "baby girls' clothing": { category: "Baby & Kids", subcategory: "Baby Clothing" },
  "girls' clothing": { category: "Baby & Kids", subcategory: "Kids' Clothing" },
  "boys' clothing": { category: "Baby & Kids", subcategory: "Kids' Clothing" },
  "toddler clothing": { category: "Baby & Kids", subcategory: "Kids' Clothing" },
  "infant clothing": { category: "Baby & Kids", subcategory: "Baby Clothing" },
  "newborn clothing": { category: "Baby & Kids", subcategory: "Baby Clothing" },

  // ── Art & Collectibles Expanded ──
  "fine art ceramics": { category: "Art & Collectibles", subcategory: "Ceramics" },
  ceramics: { category: "Art & Collectibles", subcategory: "Ceramics" },
  pottery: { category: "Art & Collectibles", subcategory: "Ceramics" },
  "coins & currency": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  coins: { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  currency: { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  stamps: { category: "Art & Collectibles", subcategory: "Stamps" },
  postcards: { category: "Art & Collectibles", subcategory: "Postcards" },
  "movie memorabilia": { category: "Art & Collectibles", subcategory: "Memorabilia" },
  "music memorabilia": { category: "Art & Collectibles", subcategory: "Memorabilia" },
  "sports collectibles": { category: "Art & Collectibles", subcategory: "Sports Memorabilia" },
  "sports memorabilia": { category: "Art & Collectibles", subcategory: "Sports Memorabilia" },
  figurines: { category: "Art & Collectibles", subcategory: "Figurines & Miniatures" },
  miniatures: { category: "Art & Collectibles", subcategory: "Figurines & Miniatures" },
  antiques: { category: "Art & Collectibles", subcategory: "Vintage & Antiques" },
  "vintage clothing": { category: "Art & Collectibles", subcategory: "Vintage & Antiques" },
  "vintage jewelry": { category: "Art & Collectibles", subcategory: "Vintage & Antiques" },
  "vintage home decor": { category: "Art & Collectibles", subcategory: "Vintage & Antiques" },

  // ── Home & Living Expanded ──
  "spirituality & religion": { category: "Home & Living", subcategory: "Spirituality & Religion" },
  spiritual: { category: "Home & Living", subcategory: "Spirituality & Religion" },
  religious: { category: "Home & Living", subcategory: "Spirituality & Religion" },
  meditation: { category: "Home & Living", subcategory: "Spirituality & Religion" },
  "home improvement": { category: "Tools & Home Improvement", subcategory: null },
  "cleaning supplies": { category: "Home & Living", subcategory: "Cleaning Supplies" },
  cleaning: { category: "Home & Living", subcategory: "Cleaning Supplies" },
  "window treatments": { category: "Home & Living", subcategory: "Curtains & Window Treatments" },
  drapes: { category: "Home & Living", subcategory: "Curtains & Window Treatments" },
  "home fragrances": { category: "Home & Living", subcategory: "Home Fragrances" },
  "air fresheners": { category: "Home & Living", subcategory: "Home Fragrances" },
  incense: { category: "Home & Living", subcategory: "Home Fragrances" },
  "wax melts": { category: "Home & Living", subcategory: "Home Fragrances" },
  "reed diffusers": { category: "Home & Living", subcategory: "Home Fragrances" },
  "room spray": { category: "Home & Living", subcategory: "Home Fragrances" },
  "food & drink": { category: "Home & Kitchen", subcategory: "Food & Drink" },
  "coffee & tea": { category: "Home & Kitchen", subcategory: "Food & Drink" },
  "office supplies": { category: "Office & School Supplies", subcategory: null },
  office: { category: "Office & School Supplies", subcategory: null },
  "home appliances": { category: "Home & Kitchen", subcategory: "Small Appliances" },

  // ── Kitchen & Dining Expanded ──
  cookware: { category: "Home & Kitchen", subcategory: "Cookware" },
  drinkware: { category: "Home & Kitchen", subcategory: "Drinkware" },
  mugs: { category: "Home & Kitchen", subcategory: "Drinkware" },
  cups: { category: "Home & Kitchen", subcategory: "Drinkware" },
  glasses: { category: "Home & Kitchen", subcategory: "Drinkware" },
  "wine glasses": { category: "Home & Kitchen", subcategory: "Drinkware" },
  "table linens": { category: "Home & Kitchen", subcategory: "Table Linens" },
  tablecloths: { category: "Home & Kitchen", subcategory: "Table Linens" },
  napkins: { category: "Home & Kitchen", subcategory: "Table Linens" },
  placemats: { category: "Home & Kitchen", subcategory: "Table Linens" },
  "bar & barware": { category: "Home & Kitchen", subcategory: "Bar & Barware" },
  barware: { category: "Home & Kitchen", subcategory: "Bar & Barware" },
  "kitchen storage": { category: "Home & Kitchen", subcategory: "Kitchen Storage" },
  "food storage": { category: "Home & Kitchen", subcategory: "Kitchen Storage" },
  containers: { category: "Home & Kitchen", subcategory: "Kitchen Storage" },

  // ── Wedding Expanded ──
  "wedding accessories": { category: "Wedding", subcategory: "Accessories" },
  "wedding clothing": { category: "Wedding", subcategory: "Bridal Gowns & Separates" },
  "wedding dresses": { category: "Wedding", subcategory: "Bridal Gowns & Separates" },
  "bridal gowns": { category: "Wedding", subcategory: "Bridal Gowns & Separates" },
  "wedding invitations": { category: "Wedding", subcategory: "Invitations & Stationery" },
  "bridal party": { category: "Wedding", subcategory: "Bridesmaids" },
  bridesmaids: { category: "Wedding", subcategory: "Bridesmaids" },
  "bridesmaid dresses": { category: "Wedding", subcategory: "Bridesmaids" },
  groomsmen: { category: "Wedding", subcategory: "Groomsmen" },
  "wedding favors": { category: "Wedding", subcategory: "Favors & Gifts" },
  "guest books": { category: "Wedding", subcategory: "Guest Books" },
  "ring pillows": { category: "Wedding", subcategory: "Ring Pillows & Boxes" },
  "ring boxes": { category: "Wedding", subcategory: "Ring Pillows & Boxes" },
  "veils & headpieces": { category: "Wedding", subcategory: "Veils" },
  veils: { category: "Wedding", subcategory: "Veils" },
  "wedding veils": { category: "Wedding", subcategory: "Veils" },
  "ceremony supplies": { category: "Wedding", subcategory: "Ceremony Supplies" },
  "reception": { category: "Wedding", subcategory: "Reception" },
  "groom's accessories": { category: "Wedding", subcategory: "Groom Accessories" },
  bouquets: { category: "Wedding", subcategory: "Flowers & Bouquets" },
  "bridal bouquets": { category: "Wedding", subcategory: "Flowers & Bouquets" },
  "wedding flowers": { category: "Wedding", subcategory: "Flowers & Bouquets" },
  "cake toppers": { category: "Wedding", subcategory: "Cake Toppers" },

  // ── Shoes Expanded ──
  boots: { category: "Shoes", subcategory: "Boots" },
  "ankle boots": { category: "Shoes", subcategory: "Boots" },
  "combat boots": { category: "Shoes", subcategory: "Boots" },
  sandals: { category: "Shoes", subcategory: "Sandals" },
  "flip flops": { category: "Shoes", subcategory: "Sandals" },
  slides: { category: "Shoes", subcategory: "Sandals" },
  heels: { category: "Shoes", subcategory: "Heels" },
  pumps: { category: "Shoes", subcategory: "Heels" },
  stilettos: { category: "Shoes", subcategory: "Heels" },
  flats: { category: "Shoes", subcategory: "Flats" },
  loafers: { category: "Shoes", subcategory: "Loafers & Slip-Ons" },
  moccasins: { category: "Shoes", subcategory: "Loafers & Slip-Ons" },
  sneakers: { category: "Shoes", subcategory: "Athletic Shoes" },
  trainers: { category: "Shoes", subcategory: "Athletic Shoes" },
  "athletic shoes": { category: "Shoes", subcategory: "Athletic Shoes" },
  slippers: { category: "Shoes", subcategory: "Slippers" },
  oxfords: { category: "Shoes", subcategory: "Oxfords" },

  // ── Toys & Games Expanded ──
  "learning & education": { category: "Toys & Games", subcategory: "Educational Toys" },
  "educational toys": { category: "Toys & Games", subcategory: "Educational Toys" },
  "pretend play": { category: "Toys & Games", subcategory: "Pretend Play" },
  "building & construction": { category: "Toys & Games", subcategory: "Building Toys" },
  "building toys": { category: "Toys & Games", subcategory: "Building Toys" },
  "legos": { category: "Toys & Games", subcategory: "Building Toys" },
  puppets: { category: "Toys & Games", subcategory: "Puppets" },
  "musical toys": { category: "Toys & Games", subcategory: "Musical Toys" },
  "ride-ons & tricycles": { category: "Toys & Games", subcategory: "Ride-Ons" },
  plushies: { category: "Toys & Games", subcategory: "Dolls & Stuffed Animals" },
  "plush toys": { category: "Toys & Games", subcategory: "Dolls & Stuffed Animals" },

  // ── Pet Supplies Expanded ──
  "dog collars": { category: "Pet Supplies", subcategory: "Dog" },
  "dog leashes": { category: "Pet Supplies", subcategory: "Dog" },
  "dog toys": { category: "Pet Supplies", subcategory: "Dog" },
  "dog beds": { category: "Pet Supplies", subcategory: "Dog" },
  "dog clothing": { category: "Pet Supplies", subcategory: "Dog" },
  "cat collars": { category: "Pet Supplies", subcategory: "Cat" },
  "cat toys": { category: "Pet Supplies", subcategory: "Cat" },
  "cat beds": { category: "Pet Supplies", subcategory: "Cat" },
  "pet carriers": { category: "Pet Supplies", subcategory: "Pet Carriers" },
  "pet feeding": { category: "Pet Supplies", subcategory: "Pet Feeding" },
  "pet bowls": { category: "Pet Supplies", subcategory: "Pet Feeding" },
  "pet grooming": { category: "Pet Supplies", subcategory: "Pet Grooming" },
  "pet id tags": { category: "Pet Supplies", subcategory: "Pet ID Tags" },
  "fish & aquatic pets": { category: "Pet Supplies", subcategory: "Fish & Aquarium" },
  aquarium: { category: "Pet Supplies", subcategory: "Fish & Aquarium" },
  "bird supplies": { category: "Pet Supplies", subcategory: "Bird" },
  "small animal supplies": { category: "Pet Supplies", subcategory: "Small Animals" },

  // ── Bath & Beauty Expanded ──
  "bath accessories": { category: "Bath & Beauty", subcategory: "Bath Accessories" },
  "bath bombs & fizzies": { category: "Bath & Beauty", subcategory: "Bath Bombs" },
  "bath bombs": { category: "Bath & Beauty", subcategory: "Bath Bombs" },
  "body oils": { category: "Bath & Beauty", subcategory: "Body Oils" },
  deodorant: { category: "Bath & Beauty", subcategory: "Personal Care" },
  "essential oils": { category: "Bath & Beauty", subcategory: "Essential Oils" },
  aromatherapy: { category: "Bath & Beauty", subcategory: "Essential Oils" },
  "lip balm": { category: "Bath & Beauty", subcategory: "Lip Care" },
  "lip balms": { category: "Bath & Beauty", subcategory: "Lip Care" },
  "lotion & body butter": { category: "Bath & Beauty", subcategory: "Body Lotion" },
  lotion: { category: "Bath & Beauty", subcategory: "Body Lotion" },
  "body butter": { category: "Bath & Beauty", subcategory: "Body Lotion" },
  "nail care": { category: "Bath & Beauty", subcategory: "Nail Care" },
  "nail polish": { category: "Bath & Beauty", subcategory: "Nail Care" },
  "personal care": { category: "Bath & Beauty", subcategory: "Personal Care" },
  "salves & balms": { category: "Bath & Beauty", subcategory: "Salves & Balms" },
  scrubs: { category: "Bath & Beauty", subcategory: "Scrubs & Exfoliators" },
  "body scrub": { category: "Bath & Beauty", subcategory: "Scrubs & Exfoliators" },
  "shaving & grooming": { category: "Bath & Beauty", subcategory: "Shaving & Grooming" },
  shaving: { category: "Bath & Beauty", subcategory: "Shaving & Grooming" },
  razors: { category: "Bath & Beauty", subcategory: "Shaving & Grooming" },
  "spa kits & gifts": { category: "Bath & Beauty", subcategory: "Spa & Gift Sets" },
  "spa gifts": { category: "Bath & Beauty", subcategory: "Spa & Gift Sets" },
  sunscreen: { category: "Bath & Beauty", subcategory: "Sun Care" },
  "sun care": { category: "Bath & Beauty", subcategory: "Sun Care" },

  // ── Craft Supplies Expanded ──
  "floral & garden supplies": { category: "Craft Supplies & Tools", subcategory: "Floral Supplies" },
  "floral supplies": { category: "Craft Supplies & Tools", subcategory: "Floral Supplies" },
  "artificial flowers": { category: "Craft Supplies & Tools", subcategory: "Floral Supplies" },
  "dried flowers": { category: "Craft Supplies & Tools", subcategory: "Floral Supplies" },
  "canvas & surfaces": { category: "Craft Supplies & Tools", subcategory: "Canvas" },
  canvas: { category: "Craft Supplies & Tools", subcategory: "Canvas" },
  "clay & modeling": { category: "Craft Supplies & Tools", subcategory: "Clay" },
  clay: { category: "Craft Supplies & Tools", subcategory: "Clay" },
  "polymer clay": { category: "Craft Supplies & Tools", subcategory: "Clay" },
  "doll & model making": { category: "Craft Supplies & Tools", subcategory: "Doll Making" },
  "drawing & drafting": { category: "Craft Supplies & Tools", subcategory: "Drawing Supplies" },
  "embellishments & trims": { category: "Craft Supplies & Tools", subcategory: "Embellishments" },
  embellishments: { category: "Craft Supplies & Tools", subcategory: "Embellishments" },
  trims: { category: "Craft Supplies & Tools", subcategory: "Embellishments" },
  ribbons: { category: "Craft Supplies & Tools", subcategory: "Embellishments" },
  buttons: { category: "Craft Supplies & Tools", subcategory: "Embellishments" },
  "frames, hoops & stands": { category: "Craft Supplies & Tools", subcategory: "Frames & Hoops" },
  "embroidery hoops": { category: "Craft Supplies & Tools", subcategory: "Frames & Hoops" },
  "glue & adhesives": { category: "Craft Supplies & Tools", subcategory: "Adhesives" },
  glue: { category: "Craft Supplies & Tools", subcategory: "Adhesives" },
  "knitting supplies": { category: "Craft Supplies & Tools", subcategory: "Knitting" },
  knitting: { category: "Craft Supplies & Tools", subcategory: "Knitting" },
  "knitting needles": { category: "Craft Supplies & Tools", subcategory: "Knitting" },
  crochet: { category: "Craft Supplies & Tools", subcategory: "Crochet" },
  "crochet hooks": { category: "Craft Supplies & Tools", subcategory: "Crochet" },
  "leather crafting": { category: "Craft Supplies & Tools", subcategory: "Leather" },
  leather: { category: "Craft Supplies & Tools", subcategory: "Leather" },
  "molds & casting": { category: "Craft Supplies & Tools", subcategory: "Molds" },
  molds: { category: "Craft Supplies & Tools", subcategory: "Molds" },
  resin: { category: "Craft Supplies & Tools", subcategory: "Resin" },
  "epoxy resin": { category: "Craft Supplies & Tools", subcategory: "Resin" },
  "paints & glazes": { category: "Craft Supplies & Tools", subcategory: "Paints" },
  paint: { category: "Craft Supplies & Tools", subcategory: "Paints" },
  "acrylic paint": { category: "Craft Supplies & Tools", subcategory: "Paints" },
  "printing & stamping": { category: "Craft Supplies & Tools", subcategory: "Stamps" },
  "rubber stamps": { category: "Craft Supplies & Tools", subcategory: "Stamps" },
  "raw materials": { category: "Craft Supplies & Tools", subcategory: "Raw Materials" },
  "sculpting & forming": { category: "Craft Supplies & Tools", subcategory: "Sculpting" },
  "tools & equipment": { category: "Craft Supplies & Tools", subcategory: "Tools" },
  "weaving & spinning": { category: "Craft Supplies & Tools", subcategory: "Weaving" },
  weaving: { category: "Craft Supplies & Tools", subcategory: "Weaving" },
  spinning: { category: "Craft Supplies & Tools", subcategory: "Spinning" },
  wood: { category: "Craft Supplies & Tools", subcategory: "Wood" },
  "woodworking supplies": { category: "Craft Supplies & Tools", subcategory: "Woodworking" },
  woodworking: { category: "Craft Supplies & Tools", subcategory: "Woodworking" },
  "scrapbooking supplies": { category: "Craft Supplies & Tools", subcategory: "Scrapbooking" },
  scrapbooking: { category: "Craft Supplies & Tools", subcategory: "Scrapbooking" },

  // ── Accessories Expanded ──
  headbands: { category: "Accessories", subcategory: "Hair Accessories" },
  "hair clips": { category: "Accessories", subcategory: "Hair Accessories" },
  "hair clips & barrettes": { category: "Accessories", subcategory: "Hair Accessories" },
  barrettes: { category: "Accessories", subcategory: "Hair Accessories" },
  "hair ties": { category: "Accessories", subcategory: "Hair Accessories" },
  "hair ties & elastics": { category: "Accessories", subcategory: "Hair Accessories" },
  scrunchies: { category: "Accessories", subcategory: "Hair Accessories" },
  "fascinators & mini hats": { category: "Accessories", subcategory: "Fascinators" },
  fascinators: { category: "Accessories", subcategory: "Fascinators" },
  "pins & pinback buttons": { category: "Accessories", subcategory: "Pins & Badges" },
  "pinback buttons": { category: "Accessories", subcategory: "Pins & Badges" },
  patches: { category: "Accessories", subcategory: "Patches" },
  "umbrellas & rain accessories": { category: "Accessories", subcategory: "Umbrellas" },
  umbrellas: { category: "Accessories", subcategory: "Umbrellas" },
  "face masks & coverings": { category: "Accessories", subcategory: "Face Masks" },
  "face masks": { category: "Accessories", subcategory: "Face Masks" },
  "boutonnieres & corsages": { category: "Accessories", subcategory: "Boutonnieres" },
  boutonnieres: { category: "Accessories", subcategory: "Boutonnieres" },
  corsages: { category: "Accessories", subcategory: "Corsages" },
  ties: { category: "Accessories", subcategory: "Ties & Pocket Squares" },
  "bow ties": { category: "Accessories", subcategory: "Ties & Pocket Squares" },
  "pocket squares": { category: "Accessories", subcategory: "Ties & Pocket Squares" },

  // ── Electronics Expanded ──
  "audio": { category: "Electronics & Accessories", subcategory: "Audio" },
  headphones: { category: "Electronics & Accessories", subcategory: "Headphones" },
  earbuds: { category: "Electronics & Accessories", subcategory: "Headphones" },
  speakers: { category: "Electronics & Accessories", subcategory: "Speakers" },
  "cables & cords": { category: "Electronics & Accessories", subcategory: "Cables" },
  cables: { category: "Electronics & Accessories", subcategory: "Cables" },
  "car electronics": { category: "Electronics & Accessories", subcategory: "Car Electronics" },
  computers: { category: "Electronics & Accessories", subcategory: "Computers" },
  "computer accessories": { category: "Electronics & Accessories", subcategory: "Computer Accessories" },
  gaming: { category: "Electronics & Accessories", subcategory: "Gaming" },
  "gaming accessories": { category: "Electronics & Accessories", subcategory: "Gaming" },
  "tablet & e-reader cases": { category: "Electronics & Accessories", subcategory: "Tablet Cases" },
  "tablet cases": { category: "Electronics & Accessories", subcategory: "Tablet Cases" },
  "laptop cases": { category: "Electronics & Accessories", subcategory: "Laptop Cases" },
  "laptop bags": { category: "Electronics & Accessories", subcategory: "Laptop Cases" },
  "chargers & adapters": { category: "Electronics & Accessories", subcategory: "Chargers" },
  chargers: { category: "Electronics & Accessories", subcategory: "Chargers" },
  adapters: { category: "Electronics & Accessories", subcategory: "Chargers" },
  "camera accessories": { category: "Electronics & Accessories", subcategory: "Camera Accessories" },
  "smart home": { category: "Electronics & Accessories", subcategory: "Smart Home" },

  // ── Books, Films & Music Expanded ──
  books: { category: "Books, Movies & Music", subcategory: "Books" },
  novels: { category: "Books, Movies & Music", subcategory: "Books" },
  "comic books": { category: "Books, Movies & Music", subcategory: "Comics" },
  comics: { category: "Books, Movies & Music", subcategory: "Comics" },
  "graphic novels": { category: "Books, Movies & Music", subcategory: "Comics" },
  manga: { category: "Books, Movies & Music", subcategory: "Comics" },
  magazines: { category: "Books, Movies & Music", subcategory: "Magazines" },
  movies: { category: "Books, Movies & Music", subcategory: "Movies" },
  "dvds": { category: "Books, Movies & Music", subcategory: "Movies" },
  "blu-ray": { category: "Books, Movies & Music", subcategory: "Movies" },
  music: { category: "Books, Movies & Music", subcategory: "Music" },
  vinyl: { category: "Books, Movies & Music", subcategory: "Music" },
  records: { category: "Books, Movies & Music", subcategory: "Music" },
  "video games": { category: "Books, Movies & Music", subcategory: "Video Games" },
  audiobooks: { category: "Books, Movies & Music", subcategory: "Audiobooks" },
  zines: { category: "Books, Movies & Music", subcategory: "Zines" },
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
  const result = matchAliasWithKey(remoteLabel, remoteSubLabel, aliases);
  return result?.result ?? null;
}

/**
 * Match alias and return both the result and the alias key that matched.
 * The key is needed for specificity scoring in eBay path resolution.
 */
function matchAliasWithKey(
  remoteLabel: string,
  remoteSubLabel: string | null | undefined,
  aliases: Record<string, AliasHit>
): { result: ResolvedInwCategory; aliasKey: string } | null {
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

  let best: { hit: AliasHit; key: string; keyLen: number; exact: boolean } | null = null;

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
        best = { hit: mapping, key: normalizedKey, keyLen, exact };
      }
    }
  }

  if (!best) return null;
  return {
    result: {
      category: best.hit.category,
      subcategory: best.hit.subcategory,
      matchedPreset: true,
      score: 1,
    },
    aliasKey: best.key,
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

  // eBay PrimaryCategory is usually "Root > Mid > Leaf" — use specificity scoring
  // to pick the most specific matching alias instead of first-match-wins.
  if (opts?.provider === "ebay" && label.includes(">")) {
    const candidates = ebayCategoryPathCandidatesWithMeta(label);
    const matches: Array<{
      hit: ResolvedInwCategory;
      aliasKey: string;
      candidate: EbayPathCandidate;
      specificityScore: number;
    }> = [];

    // Collect all alias matches with their specificity scores
    for (const candidate of candidates) {
      const segHit = matchAliasWithKey(candidate.segment, sub, aliases);
      if (segHit) {
        const specificityScore = aliasSpecificityScore(segHit.aliasKey, candidate);
        matches.push({
          hit: segHit.result,
          aliasKey: segHit.aliasKey,
          candidate,
          specificityScore,
        });
      }
    }

    // Pick the match with highest specificity score
    if (matches.length > 0) {
      matches.sort((a, b) => b.specificityScore - a.specificityScore);
      const best = matches[0]!;
      
      // Refine subcategory if the alias only matched top-level
      if (!best.hit.subcategory && sub) {
        const refined = refineSubcategory(best.hit.category, sub);
        if (refined) {
          return { ...best.hit, subcategory: refined };
        }
      }
      
      // If no subcategory, try to refine from the original path's leaf segment
      if (!best.hit.subcategory) {
        const leafCandidate = candidates.find(c => c.depth > 1 && c.components === 1);
        if (leafCandidate) {
          const refined = refineSubcategory(best.hit.category, leafCandidate.segment);
          if (refined) {
            return { ...best.hit, subcategory: refined };
          }
        }
      }
      
      return best.hit;
    }

    // No alias match found, fall through to fuzzy matching
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
 * Uses enhanced resolution to always assign subcategory when possible.
 */
export async function resolveInwCategoryFromEbayPath(
  categoryPath: string | null | undefined,
  title?: string | null
): Promise<ResolvedInwCategory | null> {
  if (!categoryPath?.trim()) return null;
  const { label, subcategory } = splitEbayCategoryPath(categoryPath);
  
  // Use the full path for resolution (not just root + leaf) to enable
  // hierarchical path alias matching like "Collectibles > Comics"
  const result = await resolveInwCategoryWithSubcategory(
    categoryPath,  // Pass full path for hierarchical matching
    subcategory,
    { provider: "ebay", title }
  );
  
  return result;
}

/**
 * Map an Etsy taxonomy id + leaf name to INW category and subcategory.
 * Uses enhanced resolution to always assign subcategory when possible.
 */
export async function resolveInwCategoryFromEtsyTaxonomy(
  taxonomyId: number | null | undefined,
  taxonomyName?: string | null,
  title?: string | null
): Promise<ResolvedInwCategory | null> {
  const name = taxonomyName?.trim() || getEtsyTaxonomyName(taxonomyId);
  if (!name) return null;

  // Use the enhanced resolver that always assigns subcategory
  return resolveInwCategoryWithSubcategory(name, null, { provider: "etsy", title });
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
 * Enhanced resolver that ALWAYS assigns a subcategory.
 * This is the recommended function for import flows - it ensures items are properly
 * organized even when remote categories are generic or poorly mapped.
 * 
 * Resolution order:
 * 1. Standard resolution (alias + fuzzy match)
 * 2. Refine subcategory from remote leaf label
 * 3. Keyword matching against subcategories
 * 4. Title-based subcategory inference
 * 5. Default to "Other [Category]" as last resort
 */
export async function resolveInwCategoryWithSubcategory(
  remoteLabel: string | null | undefined,
  remoteSubLabel?: string | null,
  opts?: ResolveCategoryOptions & { title?: string | null }
): Promise<ResolvedInwCategory | null> {
  const result = await resolveInwCategoryWithLearning(remoteLabel, remoteSubLabel, opts);
  
  if (!result?.category) return result;
  if (result.subcategory) return result;

  // If we got a category but no subcategory, try harder to assign one
  const preset = STORE_CATEGORIES.find((p) => p.label === result.category);
  if (!preset || preset.subcategories.length === 0) {
    return result;
  }

  // 1. Try refining from the remote leaf label
  const leafLabel = remoteSubLabel?.trim() || remoteLabel?.trim();
  if (leafLabel) {
    const refined = refineSubcategoryEnhanced(result.category, leafLabel);
    if (refined) {
      return { ...result, subcategory: refined };
    }
  }

  // 2. Try keyword matching against subcategories from title
  if (opts?.title) {
    const titleMatch = matchSubcategoryFromKeywords(result.category, opts.title);
    if (titleMatch) {
      return { ...result, subcategory: titleMatch };
    }
  }

  // 3. Try keyword matching against subcategories from remote label
  if (leafLabel) {
    const labelMatch = matchSubcategoryFromKeywords(result.category, leafLabel);
    if (labelMatch) {
      return { ...result, subcategory: labelMatch };
    }
  }

  // 4. Default to "Other [Category]" - find the "Other" subcategory for this category
  const otherSub = preset.subcategories.find(
    (s) => s.toLowerCase().startsWith("other ") || s === "Other"
  );
  if (otherSub) {
    return { ...result, subcategory: otherSub };
  }

  // If no "Other" subcategory exists, return without subcategory
  return result;
}

/**
 * Enhanced subcategory refinement that tries multiple matching strategies.
 */
function refineSubcategoryEnhanced(category: string, remoteSub: string): string | null {
  // First try the standard refinement
  const standard = refineSubcategory(category, remoteSub);
  if (standard) return standard;

  const preset = STORE_CATEGORIES.find((c) => c.label === category);
  if (!preset) return null;

  const normalizedRemote = normalizeLabel(remoteSub).toLowerCase();
  if (!normalizedRemote) return null;

  // Try partial word matching (e.g., "modern age" matching subcategory containing "comics")
  const remoteWords = new Set(normalizedRemote.split(/\s+/).filter((w) => w.length > 2));
  
  let best: { sub: string; matchCount: number } | null = null;
  for (const sub of preset.subcategories) {
    const subWords = new Set(normalizeLabel(sub).toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    let matchCount = 0;
    for (const word of remoteWords) {
      if (subWords.has(word)) matchCount++;
      // Also check if the subcategory contains the word
      if (normalizeLabel(sub).toLowerCase().includes(word)) matchCount += 0.5;
    }
    if (matchCount > 0 && matchCount > (best?.matchCount ?? 0)) {
      best = { sub, matchCount };
    }
  }

  return best?.sub ?? null;
}

/**
 * Match subcategory based on keyword indicators in the text.
 */
function matchSubcategoryFromKeywords(category: string, text: string): string | null {
  const preset = STORE_CATEGORIES.find((c) => c.label === category);
  if (!preset) return null;

  const normalizedText = text.toLowerCase();
  
  // Category-specific keyword mappings for subcategory inference
  const keywordMappings: Record<string, Record<string, string[]>> = {
    "Books, Movies & Music": {
      "Comics & Graphic Novels": ["comic", "manga", "graphic novel", "superhero", "marvel", "dc comics", "golden age", "silver age", "bronze age", "modern age"],
      "Books": ["book", "novel", "paperback", "hardcover", "hardback", "fiction", "non-fiction"],
      "Movies & TV": ["dvd", "blu-ray", "movie", "film", "tv show", "series", "season"],
      "Music (CDs, Vinyl, etc.)": ["cd", "vinyl", "record", "album", "lp", "ep", "cassette"],
      "Video Games": ["video game", "game disc", "playstation", "xbox", "nintendo", "ps4", "ps5"],
    },
    "Art & Collectibles": {
      "Trading Cards": ["trading card", "pokemon", "yugioh", "baseball card", "sports card", "tcg", "ccg"],
      "Coins & Currency": ["coin", "currency", "numismatic", "penny", "dollar", "mint", "bullion"],
      "Stamps": ["stamp", "philatelic", "postage"],
      "Vintage & Antiques": ["antique", "vintage", "retro", "mid-century", "victorian", "art deco"],
      "Memorabilia": ["memorabilia", "autograph", "signed", "autographed", "movie prop"],
      "Sports Memorabilia": ["sports memorabilia", "jersey", "game used", "game-used", "signed ball"],
      "Military Collectibles": ["military", "war", "army", "navy", "medal", "uniform", "wwii", "ww2"],
      "Animation Art": ["animation", "cel", "cartoon", "anime", "disney art"],
    },
    "Clothing": {
      "Women's Clothing": ["women", "womens", "woman", "ladies", "female"],
      "Men's Clothing": ["men", "mens", "man", "male", "gentleman"],
      "Kids' Clothing": ["kid", "kids", "child", "children", "boy", "girl", "toddler"],
      "Dresses & Skirts": ["dress", "skirt", "gown", "maxi", "mini"],
      "Tops & Tees": ["shirt", "top", "tee", "t-shirt", "blouse", "tank"],
      "Pants & Shorts": ["pants", "shorts", "jeans", "trousers", "leggings", "capri"],
      "Jackets & Coats": ["jacket", "coat", "blazer", "parka", "hoodie", "cardigan"],
      "Swimwear": ["swimsuit", "swimwear", "bikini", "swim trunk", "bathing suit"],
    },
    "Toys & Games": {
      "Action Figures & Collectibles": ["action figure", "figurine", "statue", "funko", "pop vinyl"],
      "Board Games & Puzzles": ["board game", "puzzle", "card game", "strategy game", "jigsaw"],
      "Dolls & Stuffed Animals": ["doll", "stuffed animal", "plush", "teddy bear", "barbie"],
      "Building & Construction": ["lego", "building blocks", "construction set", "k'nex", "megabloks"],
      "RC & Drones": ["rc", "remote control", "drone", "quadcopter", "helicopter"],
      "Model Trains": ["model train", "train set", "ho scale", "n scale", "railroad"],
    },
    "Electronics & Accessories": {
      "Phones & Accessories": ["phone", "iphone", "samsung", "android", "phone case", "charger"],
      "Computers & Tablets": ["laptop", "tablet", "computer", "ipad", "macbook", "chromebook"],
      "Gaming Consoles & Accessories": ["playstation", "xbox", "nintendo", "switch", "console", "controller"],
      "Cameras & Photo": ["camera", "dslr", "lens", "photography", "mirrorless", "gopro"],
      "Audio & Headphones": ["headphone", "earbuds", "speaker", "bluetooth", "audio", "soundbar"],
    },
    "Jewelry & Watches": {
      "Necklaces & Pendants": ["necklace", "pendant", "chain", "choker", "lariat"],
      "Bracelets": ["bracelet", "bangle", "cuff", "wristband", "charm bracelet"],
      "Earrings": ["earring", "stud", "hoop", "dangle", "drop earring"],
      "Rings": ["ring", "band", "engagement", "wedding ring", "signet"],
      "Watches": ["watch", "wristwatch", "chronograph", "smartwatch", "timepiece"],
      "Fine Jewelry": ["diamond", "gold", "silver", "platinum", "gemstone", "sapphire", "ruby", "emerald"],
    },
  };

  const categoryKeywords = keywordMappings[category];
  if (!categoryKeywords) return null;

  let bestMatch: { subcategory: string; score: number } | null = null;

  for (const [subcategory, keywords] of Object.entries(categoryKeywords)) {
    // Verify this subcategory exists in the preset
    if (!preset.subcategories.includes(subcategory)) continue;

    let score = 0;
    for (const keyword of keywords) {
      if (normalizedText.includes(keyword)) {
        // Longer keywords are more specific, give them more weight
        score += keyword.length / 5;
      }
    }

    if (score > 0 && score > (bestMatch?.score ?? 0)) {
      bestMatch = { subcategory, score };
    }
  }

  return bestMatch?.subcategory ?? null;
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
