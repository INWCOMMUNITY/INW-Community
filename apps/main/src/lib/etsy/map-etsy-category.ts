/**
 * Maps an Etsy seller-taxonomy id to an INW store category and subcategory.
 * The snapshot is the source of ids. Import does not call Etsy for this.
 */
import { getSubcategoriesForCategory, STORE_CATEGORIES } from "@/lib/store-categories";
import snapshotJson from "./seller-taxonomy.snapshot.json";

export type EtsyTaxonomyNode = {
  id: number;
  name: string;
  parentId: number | null;
  path: string[];
};

type TaxonomySnapshot = {
  source: string;
  fetchedAt: string;
  count: number;
  nodes: EtsyTaxonomyNode[];
};

const snapshot = snapshotJson as TaxonomySnapshot;

export const ETSY_TAXONOMY_NODES: readonly EtsyTaxonomyNode[] = snapshot.nodes;

const nodesById = new Map<number, EtsyTaxonomyNode>(
  ETSY_TAXONOMY_NODES.map((node) => [node.id, node])
);

const categoryLabels = new Set(STORE_CATEGORIES.map((category) => category.label));

/** Etsy root name → INW category when no more specific path rule applies. */
const ROOT_CATEGORY: Record<string, string> = {
  Accessories: "Accessories",
  "Art & Collectibles": "Art & Collectibles",
  "Bags & Purses": "Bags & Purses",
  "Bath & Beauty": "Bath & Beauty",
  "Books, Movies & Music": "Books, Movies & Music",
  Clothing: "Clothing",
  "Craft Supplies & Tools": "Craft Supplies & Tools",
  "Electronics & Accessories": "Electronics & Accessories",
  "Home & Living": "Home & Living",
  Jewelry: "Jewelry & Watches",
  "Paper & Party Supplies": "Paper & Party Supplies",
  "Pet Supplies": "Pet Supplies",
  Shoes: "Shoes",
  "Toys & Games": "Toys & Games",
  Weddings: "Wedding",
};

/**
 * Normalized Etsy node name → INW subcategory.
 * Used only when that subcategory exists on the category already chosen.
 */
const SUBCATEGORY_ALIASES: Record<string, string> = {
  "boys clothing": "Kids Clothing",
  "girls clothing": "Kids Clothing",
  "gender neutral kids clothing": "Kids Clothing",
  "baby boys clothing": "Baby Clothing",
  "baby girls clothing": "Baby Clothing",
  "gender neutral baby clothing": "Baby Clothing",
  "footies and rompers": "Baby Clothing",
  bodysuits: "Baby Clothing",
  costumes: "Costumes",
  "diaper bags": "Baby Gear & Nursery",
  "baby carriers and wraps": "Strollers & Carriers",
  diapers: "Diapering",
  "changing pads": "Diapering",
  feeding: "Feeding & Nursing",
  nursing: "Feeding & Nursing",
  "baby and toddler toys": "Toys for Baby & Toddler",
  "kids furniture": "Nursery Furniture",
  "crib skirts": "Nursery Bedding",
  "crib rail covers": "Nursery Bedding",
  "diaper stackers": "Baby Gear & Nursery",
  "diaper caddies": "Baby Gear & Nursery",
  "sports and fitness": "Activewear",
  "pajamas and robes": "Sleepwear & Loungewear",
  "shirts and tees": "Tops & Tees",
  lingerie: "Intimates & Sleepwear",
  "gender neutral adult clothing": "Unisex",
  "kilts and skirts": "Dresses & Skirts",
  "skirts and kilts": "Dresses & Skirts",
  "blazers and suits": "Suits & Blazers",
  "suits and sport coats": "Suits & Blazers",
  "pants and capris": "Pants & Shorts",
  "shorts and skorts": "Pants & Shorts",
  "boys shoes": "Kids' Shoes",
  "girls shoes": "Kids' Shoes",
  "gender neutral kids shoes": "Kids' Shoes",
  "booties and crib shoes": "Kids' Shoes",
  "sneakers and athletic shoes": "Athletic & Sneakers",
  "loafers and slip ons": "Loafers & Slip-Ons",
  "slip ons": "Loafers & Slip-Ons",
  "oxfords and wingtips": "Oxfords",
  "oxfords and tie shoes": "Oxfords",
  pumps: "Heels & Dress",
  necklaces: "Necklaces & Pendants",
  "watch bands and straps": "Watch Accessories",
  "jewelry storage": "Jewelry Care & Storage",
  "cremation and memorial jewelry": "Memorial Jewelry",
  "wedding and engagement": "Engagement & Wedding",
  "coins and money": "Coins & Currency",
  prints: "Paintings & Prints",
  militaria: "Military Collectibles",
  "sports collectibles": "Sports Memorabilia",
  "collectible jerseys": "Sports Memorabilia",
  "souvenirs and events": "Historical Memorabilia",
  "figurines and knick knacks": "Decorative Collectibles",
  "music boxes": "Decorative Collectibles",
  "collectible plates": "Decorative Collectibles",
  paperweights: "Decorative Collectibles",
  "fine art ceramics": "Decorative Collectibles",
  advertisements: "Advertising Collectibles",
  "collectible glass": "Glass Art",
  "glass insulators": "Bottles & Insulators",
  "goth and horror dolls": "Sci-Fi & Horror",
  "hats and head coverings": "Hats & Caps",
  "gloves and sleeves": "Gloves & Mittens",
  "pins and clips": "Pins & Badges",
  "pins and pinback buttons": "Pins & Badges",
  "suit and tie accessories": "Ties & Pocket Squares",
  neckties: "Ties & Pocket Squares",
  "bow ties": "Ties & Pocket Squares",
  "bolo ties": "Ties & Pocket Squares",
  ascots: "Ties & Pocket Squares",
  "fanny packs": "Crossbody & Messenger",
  "pouches and coin purses": "Wallets & Card Holders",
  "wallets and money clips": "Wallets & Card Holders",
  "market bags": "Totes & Shopping Bags",
  "cosmetic and toiletry storage": "Cosmetic Bags",
  "toiletry kits and travel cases": "Cosmetic Bags",
  "food and insulated bags": "Totes & Shopping Bags",
  "lunch bags and boxes": "Totes & Shopping Bags",
  "cameras and equipment": "Cameras & Photo",
  cameras: "Cameras & Photo",
  "computers and peripherals": "Computers & Tablets",
  "cables and cords": "Cables & Adapters",
  "batteries and charging": "Batteries & Chargers",
  "tv and projection": "TV & Video",
  televisions: "TV & Video",
  "keyboards and mice": "Computer Accessories",
  "laptop sleeves": "Laptop Cases",
  "laptop bags": "Laptop Cases",
  "camera bags and cases": "Camera Accessories",
  "telephones and handsets": "Phones & Accessories",
  "gift wrapping": "Gift Wrap & Packaging",
  "party supplies": "Party Decorations",
  "party decor": "Party Decorations",
  "note cards": "Greeting Cards",
  postcards: "Greeting Cards",
  notepads: "Journals & Notebooks",
  "stationery sets": "Journals & Notebooks",
  "writing paper": "Journals & Notebooks",
  "pet bedding": "Beds & Carriers",
  "pet beds and cots": "Beds & Carriers",
  "dolls and action figures": "Dolls & Stuffed Animals",
  "stuffed animals and plushies": "Dolls & Stuffed Animals",
  "ride on and rocking toys": "Ride-Ons",
  "learning and school": "Educational Toys",
  "play tents and playhouses": "Outdoor Play",
  "toy instruments": "Musical Toys",
  dresses: "Bridal & Gowns",
  "flower girl dresses": "Bridesmaid & Party",
  suits: "Groom & Menswear",
  decorations: "Decor & Centerpieces",
  "wedding favors": "Favors & Gifts",
  "ring bearer pillows": "Ring Pillows & Boxes",
  "duffel bags": "Travel Bags",
  "overnight bags": "Travel Bags",
  "rolling luggage": "Suitcases & Luggage",
  "briefcases and attaches": "Travel Bags",
  "luggage tags": "Travel Accessories",
  "luggage straps": "Travel Accessories",
  "passport covers": "Travel Accessories",
  "brass and horns": "Band & Orchestra",
  woodwinds: "Band & Orchestra",
  microphones: "Pro Audio & Recording",
  "synthesizers and effects": "Keyboards & Pianos",
  "zines and magazines": "Magazines & Periodicals",
  music: "Music (CDs, Vinyl, etc.)",
  "gig bags and instrument cases": "Accessories & Parts",
  "instrument straps": "Accessories & Parts",
  "picks and slides": "Accessories & Parts",
  "music cases and sleeves": "Accessories & Parts",
  "storage and organization": "Home Storage",
  "floor and rugs": "Rugs & Carpets",
  "drink and barware": "Drinkware & Bar",
  "small kitchen appliances": "Small Appliances",
  "soups and packaged mixes": "Pantry & Packaged",
  "snacks": "Pantry & Packaged",
  "grains": "Pantry & Packaged",
  "grills and accessories": "Grilling & BBQ",
  "garden decoration": "Outdoor Decor",
  "gardening tools": "Outdoor & Gardening",
  "patio furniture": "Yard & Patio",
  "hammocks and swings": "Yard & Patio",
  "fire pits and wood": "Yard & Patio",
  "ice and snow sports": "Winter Sports",
  "martial arts and boxing": "Combat Sports",
  skateboarding: "Action Sports",
  "hunting and archery": "Hunting & Fishing",
  "pet toys": "Toys & Treats",
  "pet food and treats": "Pet Feeding",
  "aquariums and tank decor": "Fish & Aquarium",
  "oral care": "Oral Care",
  supplements: "Vitamins & Supplements",
  "canes and walking": "Medical & Mobility",
  "car parts": "Car & Truck Parts",
  "car accessories": "Interior & Exterior",
  "office and school supplies": "Office Supplies",
  "handheld and pocket games": "Handhelds",
  "controllers and joysticks": "Controllers & Accessories",
  "games": "Games (physical)",
  "board games": "Board Games & Puzzles",
  "card games": "Board Games & Puzzles",
  puzzles: "Board Games & Puzzles",
  ukuleles: "Guitars & Bass",
  banjos: "Guitars & Bass",
  mandolins: "Guitars & Bass",
  "harps and lyres": "Band & Orchestra",
  "violins and bows": "Band & Orchestra",
  "replacement strings": "Accessories & Parts",
  "irons and steamers": "Cleaning & Laundry",
  irons: "Cleaning & Laundry",
  steamers: "Cleaning & Laundry",
  "weather instruments": "Home Decor",
  "appliance decals": "Home Decor",
  "large appliances": "Kitchen Appliances",
  "lighting parts": "Electrical",
  "light bulbs": "Electrical",
  "light sockets": "Electrical",
  "light switches": "Electrical",
  "lamp bases and parts": "Electrical",
  "doors and locks": "Hardware",
  "door knobs": "Hardware",
  hinges: "Hardware",
  "drawer knobs and pulls": "Hardware",
  "moldings and trim": "Hardware",
  finials: "Hardware",
  "fillers and spackling": "Paint & Supplies",
  spackling: "Paint & Supplies",
  "wood fillers": "Paint & Supplies",
  "mailers and mailing": "Gift Wrap & Packaging",
  envelopes: "Gift Wrap & Packaging",
  "mailing boxes": "Gift Wrap & Packaging",
  "mailing tubes": "Gift Wrap & Packaging",
  "bubble and padded mailers": "Gift Wrap & Packaging",
  "bubble wrap": "Gift Wrap & Packaging",
  programs: "Invitations",
  "recipe cards": "Journals & Notebooks",
  "paper flowers": "Party Decorations",
  worksheets: "School Supplies",
  flashcards: "School Supplies",
  "study guides": "School Supplies",
  "entryway and mudroom furniture": "Accent & Occasional",
  "food starters and additives": "Pantry & Packaged",
  "condiments and sauces": "Pantry & Packaged",
  "lawn games": "Outdoor Gear",
  "kites and pinwheels": "Outdoor Gear",
  "swings and slides": "Outdoor Gear",
  "juggling and hula hoops": "Outdoor Gear",
  "flying toys": "Outdoor Gear",
  "bocce ball": "Outdoor Gear",
  cornhole: "Outdoor Gear",
  croquet: "Outdoor Gear",
  horseshoes: "Outdoor Gear",
  kites: "Outdoor Gear",
  pinwheels: "Outdoor Gear",
  swings: "Outdoor Gear",
  slides: "Outdoor Gear",
  "hula hoops": "Outdoor Gear",
  juggling: "Outdoor Gear",
  balls: "Outdoor Gear",
  bowling: "Team Sports",
  clogs: "Sandals & Flats",
  "garment bags": "Travel Bags",
  "train cases": "Travel Bags",
  "travel wallets": "Travel Accessories",
  "luggage covers": "Travel Accessories",
  "pet dental": "Pet Grooming",
  "bibs and burping": "Feeding & Nursing",
  "pacifiers and clips": "Feeding & Nursing",
  teething: "Feeding & Nursing",
  "cloth wipes": "Diapering",
  "baby gift sets": "Baby Gear & Nursery",
  "laptop skins": "Computer Accessories",
  "laptop decals": "Computer Accessories",
  laptop: "Computer Accessories",
  "phone decals": "Phones & Accessories",
  "phone skins": "Phones & Accessories",
  phone: "Phones & Accessories",
  "tablet skins": "Computers & Tablets",
  "tablet decals": "Computers & Tablets",
  tablet: "Computers & Tablets",
  "keyboard skins": "Computer Accessories",
  "keyboard decals": "Computer Accessories",
  keyboard: "Computer Accessories",
  "decals and skins": "Computer Accessories",
  "docking and stands": "Computer Accessories",
  "docking stations": "Computer Accessories",
  "laptop trays and stands": "Computer Accessories",
  stands: "Computer Accessories",
  "raspberry pi and arduino": "Computers & Tablets",
  robotics: "Computers & Tablets",
  "maker supplies": "Computers & Tablets",
  "3d printing and machining": "Computers & Tablets",
  "stereos and home audio": "Speakers",
  "record players": "Audio & Headphones",
  "boomboxes and portable audio": "Audio & Headphones",
  "arcade games": "Retro & Vintage",
  pinball: "Retro & Vintage",
  "parts and modifications": "Controllers & Accessories",
  "controller modifications": "Controllers & Accessories",
  "role playing games": "Board Games & Puzzles",
  "action figures": "Action Figures & Collectibles",
  "push and pull toys": "Preschool Toys",
  wagons: "Preschool Toys",
  "wind-up toys": "Preschool Toys",
  "pet hammocks": "Beds & Carriers",
  "beach bags": "Totes & Shopping Bags",
  "team sports and gym bags": "Backpacks",
  "role playing miniatures": "Pretend Play",
};

/**
 * Same Etsy name, different INW subcategory once the category is already chosen.
 * Checked before the global alias list.
 */
const SCOPED_SUBCATEGORY: Record<string, Record<string, string>> = {
  "Musical Instruments": {
    bows: "Accessories & Parts",
    microphones: "Pro Audio & Recording",
  },
  "Electronics & Accessories": {
    microphones: "Audio & Headphones",
  },
  Wedding: {
    bracelets: "Accessories",
    brooches: "Accessories",
    earrings: "Accessories",
    necklaces: "Accessories",
    "pendant necklaces": "Accessories",
    "jewelry sets": "Accessories",
    jewelry: "Accessories",
    shoes: "Accessories",
    "mens wedding shoes": "Accessories",
    "womens wedding shoes": "Accessories",
    "girls wedding shoes": "Accessories",
    "boys wedding shoes": "Accessories",
    "lingerie and garters": "Accessories",
    "wedding lingerie": "Accessories",
    "wedding garters": "Accessories",
    "cuff links and tie clips": "Groom Accessories",
    "cuff links": "Groom Accessories",
    "tie clips and tacks": "Groom Accessories",
    "shirt studs": "Groom Accessories",
    "gifts for the couple": "Favors & Gifts",
    "albums and scrapbooks": "Guest Books",
    "portraits and frames": "Decor & Centerpieces",
    portraits: "Decor & Centerpieces",
    "picture frames": "Decor & Centerpieces",
    "shrugs and boleros": "Bridal & Gowns",
    "jumpsuits and rompers": "Bridal & Gowns",
    "wedding dress hangers": "Bridal & Gowns",
  },
  "Toys & Games": {
    balls: "Outdoor Play",
  },
};

const STOP_TOKENS = new Set(["and", "the", "for", "with", "of", "or"]);

const RULES: Array<{ test: (path: string[]) => boolean; category: string }> = [
  { test: (path) => rootOf(path) === "Weddings", category: "Wedding" },
  { test: (path) => rootOf(path) === "Jewelry", category: "Jewelry & Watches" },
  { test: (path) => has(path, "Food & Drink"), category: "Food & Drink" },
  { test: (path) => has(path, "Kids' Furniture"), category: "Baby & Kids" },
  { test: (path) => has(path, "Furniture"), category: "Furniture" },
  { test: (path) => has(path, "Kitchen & Dining"), category: "Home & Kitchen" },
  { test: (path) => has(path, "Outdoor & Gardening"), category: "Home & Garden" },
  { test: (path) => has(path, "Floor & Rugs"), category: "Furniture" },
  { test: (path) => has(path, "Home Improvement"), category: "Tools & Home Improvement" },
  { test: (path) => has(path, "Office"), category: "Office & School Supplies" },
  { test: (path) => has(path, "Large Appliances"), category: "Home & Kitchen" },
  { test: (path) => has(path, "Seasonal Decor"), category: "Home & Garden" },
  { test: (path) => has(path, "Worksheets", "Flashcards", "Study Guides"), category: "Office & School Supplies" },
  { test: (path) => has(path, "Pinball"), category: "Video Games & Consoles" },
  { test: (path) => has(path, "Pool & Billiards", "Darts"), category: "Sports & Outdoors" },
  {
    test: (path) => has(path, "Crib Skirts", "Crib Rail Covers", "Diaper Stackers", "Diaper Caddies"),
    category: "Baby & Kids",
  },
  { test: (path) => has(path, "Video Games"), category: "Video Games & Consoles" },
  { test: (path) => has(path, "Car Parts & Accessories"), category: "Vehicles & Parts" },
  {
    test: (path) =>
      has(path, "Musical Instruments", "Gig Bags & Instrument Cases", "Instrument Straps", "Picks & Slides"),
    category: "Musical Instruments",
  },
  {
    test: (path) => has(path, "Baby & Child Care", "Diaper Bags", "Baby & Toddler Toys"),
    category: "Baby & Kids",
  },
  {
    test: (path) => has(path, "Boys' Clothing", "Girls' Clothing", "Gender-Neutral Kids' Clothing"),
    category: "Baby & Kids",
  },
  { test: (path) => has(path, "Beekeeping"), category: "Home & Garden" },
  { test: (path) => has(path, "Sports & Outdoor Recreation"), category: "Sports & Outdoors" },
  { test: (path) => has(path, "Luggage & Travel"), category: "Luggage & Travel" },
  { test: (path) => has(path, "Oral Care", "Supplements", "Canes & Walking"), category: "Health & Personal Care" },
];

export type InwCategoryMapping = {
  category: string;
  subcategory: string;
};

/** Resolve a seller taxonomy id. Unknown ids return null so import still succeeds. */
export function mapEtsyTaxonomyToInw(taxonomyId: number): InwCategoryMapping | null {
  if (!Number.isInteger(taxonomyId) || taxonomyId <= 0) return null;
  const node = nodesById.get(taxonomyId);
  if (!node) return null;
  const category = chooseCategory(node.path);
  if (!category || !categoryLabels.has(category)) return null;
  const subcategory = pickSubcategory(category, node.path);
  if (!getSubcategoriesForCategory(category).includes(subcategory)) return null;
  return { category, subcategory };
}

function chooseCategory(path: string[]): string | null {
  for (const rule of RULES) {
    if (rule.test(path)) return rule.category;
  }
  return ROOT_CATEGORY[rootOf(path)] ?? null;
}

function pickSubcategory(category: string, path: string[]): string {
  const subs = getSubcategoriesForCategory(category);
  const other = subs.find((sub) => sub.startsWith("Other ")) ?? subs[subs.length - 1] ?? "";
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const match = matchSubcategory(category, path[index] ?? "", subs);
    if (match) return match;
  }
  return other;
}

function matchSubcategory(category: string, name: string, subs: string[]): string | null {
  const normalized = norm(name);
  const scoped = SCOPED_SUBCATEGORY[category]?.[normalized];
  if (scoped && subs.includes(scoped)) return scoped;
  const alias = SUBCATEGORY_ALIASES[normalized];
  if (alias && subs.includes(alias)) return alias;

  for (const sub of subs) {
    if (norm(sub) === normalized) return sub;
  }

  const segmentTokens = tokensOf(name);
  if (segmentTokens.length === 0) return null;

  let best: { sub: string; score: number; distance: number } | null = null;
  let tied = false;
  for (const sub of subs) {
    if (sub.startsWith("Other ")) continue;
    const subTokens = tokensOf(sub);
    const score = subsetScore(segmentTokens, subTokens);
    if (score <= 0) continue;
    const distance = Math.abs(segmentTokens.length - subTokens.length);
    if (!best || score > best.score || (score === best.score && distance < best.distance)) {
      best = { sub, score, distance };
      tied = false;
    } else if (score === best.score && distance === best.distance && sub !== best.sub) {
      tied = true;
    }
  }
  if (!best || tied) return null;
  return best.sub;
}

/** Score when every token of the shorter list appears in the longer list. */
function subsetScore(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const [shorter, longer] = a.size <= b.size ? [a, b] : [b, a];
  if (shorter.size === 0) return 0;
  for (const token of shorter) {
    if (!longer.has(token)) return 0;
  }
  return shorter.size;
}

function tokensOf(value: string): string[] {
  return norm(value)
    .split(" ")
    .map(stem)
    .filter((token) => token.length >= 3 && !STOP_TOKENS.has(token));
}

function stem(token: string): string {
  if (token === "glasses" || token === "clothes") return token;
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (
    token.length > 3 &&
    token.endsWith("s") &&
    !token.endsWith("ss") &&
    !token.endsWith("us") &&
    !token.endsWith("is")
  ) {
    return token.slice(0, -1);
  }
  return token;
}

function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bjewellery\b/g, "jewelry")
    .replace(/\bfilms\b/g, "movies")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function rootOf(path: string[]): string {
  return path[0] ?? "";
}

function has(path: string[], ...names: string[]): boolean {
  const wanted = new Set(names);
  return path.some((segment) => wanted.has(segment));
}
