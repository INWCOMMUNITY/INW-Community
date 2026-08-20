import type { ChannelConnectionContext, RemoteListingSummary, SyncStoreItem } from "../types";
import { listingDescriptionToPlainText } from "../rich-description";
import { isEtsyWhoMade, normalizeEtsyWhenMade } from "@/lib/etsy-listing-options";

/**
 * Map of Etsy taxonomy IDs to category names.
 * Expanded coverage of Etsy's seller taxonomy for better auto-categorization.
 * Source: Etsy Open API GET /seller-taxonomy/nodes
 */
const ETSY_TAXONOMY_NAMES: Record<number, string> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // TOP-LEVEL CATEGORIES (16 main categories)
  // ═══════════════════════════════════════════════════════════════════════════
  1: "Art & Collectibles",
  4: "Art & Collectibles",
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
  281: "Vintage",
  891: "Home & Living",
  1430: "Jewelry & Accessories",
  68887482: "Craft Supplies & Tools",
  69150408: "Clothing & Shoes",

  // ═══════════════════════════════════════════════════════════════════════════
  // ART & COLLECTIBLES (ID: 1, 4)
  // ═══════════════════════════════════════════════════════════════════════════
  18: "Photography",
  19: "Painting",
  20: "Artist Trading Cards",
  21: "Prints",
  22: "Fine Art Ceramics",
  23: "Sculpture",
  24: "Drawing & Illustration",
  25: "Mixed Media & Collage",
  26: "Fiber Arts",
  27: "Glass Art",
  28: "Collectibles",
  29: "Dolls & Miniatures",
  30: "Figurines",
  31: "Music & Movie Memorabilia",
  32: "Vintage Posters",
  33: "Coins & Money",
  34: "Stamps",
  35: "Sports Collectibles",
  36: "Souvenirs & Events",
  37: "Militaria",
  38: "Political Memorabilia",
  39: "Advertising",
  40: "Tobacciana",

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCESSORIES (ID: 77)
  // ═══════════════════════════════════════════════════════════════════════════
  262: "Hats & Caps",
  263: "Beanies & Winter Hats",
  264: "Scarves & Wraps",
  265: "Belts & Suspenders",
  266: "Sunglasses & Eyewear",
  267: "Gloves & Mittens",
  268: "Hair Accessories",
  269: "Headbands",
  270: "Hair Clips & Barrettes",
  271: "Hair Ties & Elastics",
  272: "Scrunchies",
  273: "Fascinators & Mini Hats",
  274: "Keychains & Lanyards",
  275: "Pins & Pinback Buttons",
  276: "Patches",
  277: "Umbrellas & Rain Accessories",
  278: "Face Masks & Coverings",
  279: "Costume Accessories",
  280: "Boutonnieres & Corsages",

  // ═══════════════════════════════════════════════════════════════════════════
  // BAGS & PURSES (ID: 78)
  // ═══════════════════════════════════════════════════════════════════════════
  301: "Backpacks",
  302: "Handbags",
  303: "Clutches & Evening Bags",
  304: "Messenger Bags",
  305: "Wallets & Money Clips",
  306: "Totes",
  307: "Shoulder Bags",
  308: "Crossbody Bags",
  309: "Bucket Bags",
  310: "Fanny Packs",
  311: "Luggage & Travel",
  312: "Cosmetic & Toiletry Bags",
  313: "Diaper Bags",
  314: "Laptop Bags",
  315: "Market Bags",
  316: "Pouches & Coin Purses",
  317: "Sports Bags",
  318: "Weekender Bags",

  // ═══════════════════════════════════════════════════════════════════════════
  // CRAFT SUPPLIES & TOOLS (ID: 82)
  // ═══════════════════════════════════════════════════════════════════════════
  331: "Fabric",
  332: "Beads",
  333: "Sewing & Needlecraft",
  334: "Yarn & Fiber",
  335: "Jewelry Making",
  336: "Paper, Party & Kids",
  337: "Floral & Garden Supplies",
  338: "Canvas & Surfaces",
  339: "Clay & Modeling",
  340: "Doll & Model Making",
  341: "Drawing & Drafting",
  342: "Embellishments & Trims",
  343: "Frames, Hoops & Stands",
  344: "Glue & Adhesives",
  345: "Knitting Supplies",
  346: "Leather Crafting",
  347: "Lighting Supplies",
  348: "Metal",
  349: "Molds & Casting",
  350: "Paints & Glazes",
  351: "Patterns & How To",
  352: "Printing & Stamping",
  353: "Raw Materials",
  354: "Sculpting & Forming",
  355: "Tools & Equipment",
  356: "Weaving & Spinning",
  357: "Wood",
  358: "Woodworking Supplies",
  359: "Scrapbooking Supplies",
  360: "Visual Arts Supplies",

  // ═══════════════════════════════════════════════════════════════════════════
  // CLOTHING (ID: 81)
  // ═══════════════════════════════════════════════════════════════════════════
  361: "Dresses",
  362: "Tops & Tees",
  363: "Pants & Capris",
  364: "Skirts",
  365: "Sweaters",
  366: "Jackets & Coats",
  367: "Suits & Blazers",
  368: "Shorts",
  369: "Swimwear",
  370: "Women's Clothing",
  371: "Men's Clothing",
  372: "Unisex Adult Clothing",
  373: "Girls' Clothing",
  374: "Boys' Clothing",
  380: "Baby Clothing",
  381: "Activewear",
  382: "Costumes",
  383: "Intimates & Sleepwear",
  384: "Jumpsuits & Rompers",
  385: "Maternity",
  386: "Overalls & Jeans",
  387: "Ponchos & Capes",
  388: "Rainwear",
  389: "Robes & Wraps",
  390: "Socks & Leg Warmers",
  391: "Underwear",
  392: "Vests",
  393: "Indian Ethnic Clothing",
  394: "Gender-Neutral Adult Clothing",
  395: "Gender-Neutral Kids' Clothing",

  // ═══════════════════════════════════════════════════════════════════════════
  // BATH & BEAUTY (ID: 79)
  // ═══════════════════════════════════════════════════════════════════════════
  375: "Skin Care",
  376: "Soaps",
  377: "Hair Care",
  378: "Makeup & Cosmetics",
  379: "Fragrances",
  401: "Bath Accessories",
  402: "Bath Bombs & Fizzies",
  403: "Body Oils",
  404: "Deodorant",
  405: "Essential Oils",
  406: "Lip Balm",
  407: "Lotion & Body Butter",
  408: "Nail Care",
  409: "Personal Care",
  410: "Salves & Balms",
  411: "Scrubs",
  412: "Shaving & Grooming",
  413: "Spa Kits & Gifts",
  414: "Sunscreen",

  // ═══════════════════════════════════════════════════════════════════════════
  // HOME & LIVING (ID: 84, 891)
  // ═══════════════════════════════════════════════════════════════════════════
  428: "Bedding",
  429: "Bathroom",
  430: "Kitchen & Dining",
  431: "Lighting",
  432: "Outdoor & Garden",
  433: "Rugs",
  434: "Storage & Organization",
  435: "Furniture",
  436: "Living Room Furniture",
  437: "Bedroom Furniture",
  438: "Office Furniture",
  439: "Dining Room Furniture",
  440: "Outdoor Furniture",
  441: "Home Decor",
  442: "Wall Decor",
  443: "Wall Hangings",
  444: "Candles & Holders",
  445: "Clocks",
  446: "Frames & Displays",
  447: "Mirrors",
  448: "Ornaments & Accents",
  449: "Pillows",
  450: "Throws & Blankets",
  451: "Vases",
  452: "Window Treatments",
  453: "Curtains & Window Treatments",
  454: "Home Fragrances",
  455: "Office",
  456: "Food & Drink",
  457: "Cleaning Supplies",
  458: "Home Improvement",
  459: "Spirituality & Religion",
  460: "Home Appliances",
  461: "Cookware",
  462: "Drinkware",
  463: "Dining & Serving",
  464: "Kitchen Storage",
  465: "Bar & Barware",
  466: "Linens",
  467: "Table Linens",

  // ═══════════════════════════════════════════════════════════════════════════
  // JEWELRY (ID: 85, 1430)
  // ═══════════════════════════════════════════════════════════════════════════
  481: "Bracelets",
  482: "Bangles",
  483: "Earrings",
  484: "Stud Earrings",
  485: "Necklaces",
  486: "Pendant Necklaces",
  487: "Rings",
  488: "Statement Rings",
  489: "Body Jewelry",
  490: "Anklets",
  491: "Watches",
  492: "Brooches, Pins & Clips",
  493: "Cuff Links & Tie Clips",
  494: "Jewelry Sets",
  495: "Jewelry Storage",
  496: "Smart Jewelry",
  497: "Cremation & Memorial Jewelry",
  498: "Charm Bracelets",
  499: "Chain & Link Bracelets",
  500: "Cuff Bracelets",
  501: "Beaded Bracelets",
  502: "Friendship Bracelets",
  503: "ID & Medical Bracelets",
  504: "Hand Chains",
  505: "Dangle & Drop Earrings",
  506: "Hoop Earrings",
  507: "Chandelier Earrings",
  508: "Clip-On Earrings",
  509: "Ear Jackets & Climbers",
  510: "Threader Earrings",
  511: "Gauge & Plug Earrings",
  512: "Kaan Chains",
  513: "Chandbalis",
  514: "Jhumkas",
  515: "Choker Necklaces",
  516: "Collar Necklaces",
  517: "Lariat & Y Necklaces",
  518: "Multi-Strand Necklaces",
  519: "Wedding Bands",
  520: "Engagement Rings",
  521: "Signet Rings",
  522: "Belly Chains",
  523: "Belly Rings",

  // ═══════════════════════════════════════════════════════════════════════════
  // PAPER & PARTY SUPPLIES (ID: 86)
  // ═══════════════════════════════════════════════════════════════════════════
  524: "Party Supplies",
  525: "Invitations & Announcements",
  526: "Greeting Cards",
  527: "Calendars & Planners",
  528: "Stickers, Labels & Tags",
  529: "Gift Wrapping",
  530: "Banners & Signs",
  531: "Cake Toppers & Picks",
  532: "Centerpieces",
  533: "Confetti",
  534: "Favors",
  535: "Balloons",
  536: "Games",
  537: "Party Hats",
  538: "Streamers",
  539: "Tableware",
  540: "Wearables",
  541: "Notebooks & Journals",
  542: "Paper Goods",
  543: "Photo Albums & Scrapbooks",
  544: "Postcards",
  545: "Writing & Stationery",

  // ═══════════════════════════════════════════════════════════════════════════
  // PET SUPPLIES (ID: 87)
  // ═══════════════════════════════════════════════════════════════════════════
  551: "Pet Collars & Leashes",
  552: "Pet Furniture",
  553: "Pet Clothing",
  554: "Pet Toys",
  555: "Pet Beds",
  556: "Dog Supplies",
  557: "Cat Supplies",
  558: "Fish & Aquatic Pets",
  559: "Bird Supplies",
  560: "Small Animal Supplies",
  565: "Pet Carriers & Houses",
  566: "Pet Feeding",
  567: "Pet Grooming",
  568: "Pet Health",
  569: "Pet ID Tags",
  570: "Pet Memorial",
  571: "Pet Portraits",

  // ═══════════════════════════════════════════════════════════════════════════
  // SHOES (ID: 88)
  // ═══════════════════════════════════════════════════════════════════════════
  561: "Women's Shoes",
  562: "Men's Shoes",
  563: "Unisex Shoes",
  564: "Children's Shoes",
  572: "Athletic Shoes",
  573: "Boots",
  574: "Flats",
  575: "Heels",
  576: "Loafers & Slip-Ons",
  577: "Oxfords & Tie Shoes",
  578: "Sandals",
  579: "Slippers",

  // ═══════════════════════════════════════════════════════════════════════════
  // TOYS & GAMES (ID: 89)
  // ═══════════════════════════════════════════════════════════════════════════
  580: "Dolls & Action Figures",
  581: "Games & Puzzles",
  582: "Sports & Outdoor",
  583: "Stuffed Animals & Plushies",
  584: "Learning & Education",
  585: "Pretend Play",
  586: "Ride-Ons & Tricycles",
  587: "Building & Construction",
  588: "Puppets",
  589: "Musical Toys",
  590: "Art & Drawing Toys",

  // ═══════════════════════════════════════════════════════════════════════════
  // WEDDINGS (ID: 90)
  // ═══════════════════════════════════════════════════════════════════════════
  591: "Wedding Accessories",
  592: "Wedding Clothing",
  593: "Wedding Decorations",
  594: "Gifts & Mementos",
  595: "Wedding Invitations & Paper",
  596: "Bridal Party",
  597: "Ceremony Supplies",
  598: "Reception",
  599: "Groom's Accessories",
  600: "Ring Pillows & Boxes",
  601: "Veils & Headpieces",
  602: "Wedding Favors",
  603: "Guest Books",
  604: "Bridesmaid Gifts",
  605: "Groomsmen Gifts",

  // ═══════════════════════════════════════════════════════════════════════════
  // BOOKS, FILMS & MUSIC (ID: 80)
  // ═══════════════════════════════════════════════════════════════════════════
  610: "Books",
  611: "Comics & Graphic Novels",
  612: "Magazines",
  613: "Movies",
  614: "Music",
  615: "Video Games",
  616: "Audiobooks",
  617: "Blank Books",
  618: "Zines",

  // ═══════════════════════════════════════════════════════════════════════════
  // ELECTRONICS & ACCESSORIES (ID: 83)
  // ═══════════════════════════════════════════════════════════════════════════
  620: "Audio",
  621: "Cables & Cords",
  622: "Car Electronics",
  623: "Computers",
  624: "Gadgets",
  625: "Gaming",
  626: "Mobile Phone Cases",
  627: "Tablet & E-Reader Cases",
  628: "Laptop Cases",
  629: "Video",
  630: "Docking Stations",
  631: "Chargers & Adapters",
  632: "Headphones",
  633: "Speakers",
  634: "Camera Accessories",
  635: "Smart Home",

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDITIONAL COMMON TAXONOMY IDs (from Etsy's API)
  // ═══════════════════════════════════════════════════════════════════════════
  1016: "Vintage Clothing",
  1018: "Vintage Accessories",
  1020: "Vintage Art",
  1022: "Vintage Collectibles",
  1024: "Vintage Home Decor",
  1026: "Vintage Jewelry",
  1028: "Vintage Toys",
  1622: "Art & Collectibles",
  1760: "Clothing",
  1856: "Jewelry",
  2048: "Home & Living",
  2078: "Craft Supplies",
  6000: "Handmade",
  6648: "Accessories",
  6938: "Bags",
  7710: "Bath & Body",
  7740: "Beauty",
  8710: "Clothing",
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

/** All known Etsy taxonomy IDs and display names (for DB mapping seed). */
export function listEtsyTaxonomyEntries(): Array<{ id: number; name: string }> {
  return Object.entries(ETSY_TAXONOMY_NAMES).map(([id, name]) => ({
    id: Number(id),
    name,
  }));
}

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
  overrides?: { taxonomyId?: number; shippingProfileId?: string | null; readinessStateId?: number }
): Record<string, string | number | boolean | undefined> {
  const whoMade = isEtsyWhoMade(item.etsyWhoMade) ? item.etsyWhoMade : null;
  const whenMade = normalizeEtsyWhenMade(item.etsyWhenMade);
  const taxonomyId = overrides?.taxonomyId ?? item.etsyTaxonomyId ?? null;
  if (!whoMade) {
    throw new Error('Etsy requires you to specify who made the item (select "Who made it?").');
  }
  if (!whenMade) {
    throw new Error('Etsy requires you to specify when it was made (select "When was it made?").');
  }
  if (!taxonomyId) {
    throw new Error("Etsy requires a category before listing. Choose an Etsy category on the item.");
  }
  const shippingId = overrides?.shippingProfileId ?? conn.etsyShippingProfileId;
  const readinessStateId = overrides?.readinessStateId;
  if (readinessStateId == null) {
    throw new Error(
      "Etsy requires a processing profile (how long you take to ship) before listing. Add one in your Etsy Shop Manager, then refresh Etsy in Sync Stores."
    );
  }
  return {
    quantity: Math.max(1, item.quantity),
    title: etsyTitle(item.title),
    description: etsyDescription(item),
    price: etsyPriceFromCents(item.priceCents),
    who_made: whoMade,
    when_made: whenMade,
    taxonomy_id: taxonomyId,
    is_supply: item.etsyIsSupply ?? false,
    type: "physical",
    ...(shippingId ? { shipping_profile_id: Number(shippingId) } : {}),
    readiness_state_id: readinessStateId,
  };
}

/** Fields for updateListing (PATCH /shops/{shop_id}/listings/{listing_id}). */
export function buildEtsyUpdateFields(
  item: SyncStoreItem,
  overrides?: { taxonomyId?: number; shippingProfileId?: string | null }
): Record<string, string | number | boolean | undefined> {
  const shippingId = overrides?.shippingProfileId;
  const whoMade = isEtsyWhoMade(item.etsyWhoMade) ? item.etsyWhoMade : undefined;
  const whenMade = normalizeEtsyWhenMade(item.etsyWhenMade) ?? undefined;
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
