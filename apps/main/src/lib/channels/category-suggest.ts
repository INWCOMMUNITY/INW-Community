/**
 * Outbound category suggestion: INW categories → provider-specific taxonomies.
 * Used when publishing listings to help sellers select the best category on each channel.
 */

import type { ChannelProvider, ChannelConnectionContext } from "./types";
import { STORE_CATEGORIES } from "@/lib/store-categories";
import { similarityScore } from "./category-resolver";

export interface CategorySuggestion {
  provider: ChannelProvider;
  categoryId: string | number;
  categoryPath: string;
  confidence: number;
}

export interface SuggestCategoriesResult {
  ebay?: CategorySuggestion[];
  etsy?: CategorySuggestion[];
  shopify?: CategorySuggestion[];
  wix?: CategorySuggestion[];
}

/**
 * Reverse mapping: INW category → common eBay category IDs (US marketplace).
 * These are leaf categories known to work well for each INW preset.
 */
const INW_TO_EBAY_CATEGORIES: Record<string, { id: string; path: string }[]> = {
  "Art & Collectibles": [
    { id: "550", path: "Art" },
    { id: "1", path: "Collectibles" },
    { id: "870", path: "Pottery & Glass" },
    { id: "20081", path: "Antiques" },
  ],
  "Art & Collectibles > Coins & Currency": [
    { id: "11116", path: "Coins & Paper Money" },
    { id: "253", path: "Coins & Paper Money > Coins: US" },
    { id: "256", path: "Coins & Paper Money > Coins: World" },
    { id: "3411", path: "Coins & Paper Money > Paper Money: US" },
  ],
  "Art & Collectibles > Trading Cards": [
    { id: "212", path: "Sports Mem, Cards & Fan Shop > Sports Trading Cards" },
    { id: "183050", path: "Collectibles > Non-Sport Trading Cards" },
  ],
  Accessories: [
    { id: "4250", path: "Clothing, Shoes & Accessories > Women's Accessories" },
    { id: "4251", path: "Clothing, Shoes & Accessories > Men's Accessories" },
  ],
  "Accessories > Hats & Caps": [
    { id: "52382", path: "Clothing, Shoes & Accessories > Men's Accessories > Hats" },
    { id: "45220", path: "Clothing, Shoes & Accessories > Women's Accessories > Hats" },
  ],
  "Bags & Purses": [
    { id: "169291", path: "Clothing, Shoes & Accessories > Women's Bags & Handbags" },
    { id: "169285", path: "Clothing, Shoes & Accessories > Men's Accessories > Bags" },
  ],
  "Bath & Beauty": [
    { id: "26395", path: "Health & Beauty" },
    { id: "11838", path: "Health & Beauty > Skin Care" },
  ],
  "Books, Movies & Music": [
    { id: "267", path: "Books" },
    { id: "11232", path: "DVDs & Blu-ray Discs" },
    { id: "11233", path: "Music" },
  ],
  Clothing: [
    { id: "11450", path: "Clothing, Shoes & Accessories > Women's Clothing" },
    { id: "1059", path: "Clothing, Shoes & Accessories > Men's Clothing" },
  ],
  "Craft Supplies & Tools": [
    { id: "14339", path: "Crafts" },
    { id: "160647", path: "Crafts > Art Supplies" },
  ],
  "Electronics & Accessories": [
    { id: "293", path: "Consumer Electronics" },
    { id: "15032", path: "Cell Phones & Accessories" },
  ],
  Furniture: [
    { id: "3197", path: "Home & Garden > Furniture" },
    { id: "183302", path: "Home & Garden > Furniture > Living Room Furniture" },
  ],
  "Home & Living": [
    { id: "11700", path: "Home & Garden > Home Décor" },
    { id: "20697", path: "Home & Garden > Yard, Garden & Outdoor Living" },
  ],
  "Home & Kitchen": [
    { id: "20625", path: "Home & Garden > Kitchen, Dining & Bar" },
    { id: "38226", path: "Home & Garden > Kitchen, Dining & Bar > Cookware" },
  ],
  "Jewelry & Watches": [
    { id: "281", path: "Jewelry & Watches > Fine Jewelry" },
    { id: "10968", path: "Jewelry & Watches > Fashion Jewelry" },
    { id: "31387", path: "Jewelry & Watches > Watches" },
  ],
  "Paper & Party Supplies": [
    { id: "94", path: "Crafts > Scrapbooking & Paper Crafts" },
    { id: "15032", path: "Home & Garden > Greeting Cards & Party Supply" },
  ],
  "Pet Supplies": [
    { id: "1281", path: "Pet Supplies" },
    { id: "20742", path: "Pet Supplies > Dog Supplies" },
  ],
  Shoes: [
    { id: "3034", path: "Clothing, Shoes & Accessories > Women's Shoes" },
    { id: "93427", path: "Clothing, Shoes & Accessories > Men's Shoes" },
  ],
  "Sports & Outdoors": [
    { id: "888", path: "Sporting Goods" },
    { id: "159043", path: "Sporting Goods > Outdoor Sports" },
  ],
  "Toys & Games": [
    { id: "220", path: "Toys & Hobbies" },
    { id: "2550", path: "Toys & Hobbies > Games" },
  ],
  Wedding: [
    { id: "184078", path: "Home & Garden > Wedding Supplies" },
  ],
  "Baby & Kids": [
    { id: "2984", path: "Baby" },
    { id: "171146", path: "Clothing, Shoes & Accessories > Kids' Clothing" },
  ],
  "Business & Industrial": [
    { id: "12576", path: "Business & Industrial" },
    { id: "25298", path: "Business & Industrial > Healthcare, Lab & Dental" },
  ],
  "Tickets & Experiences": [
    { id: "1305", path: "Tickets & Experiences" },
    { id: "552", path: "Tickets & Experiences > Concerts" },
  ],
};

/**
 * Reverse mapping: INW category → Etsy taxonomy IDs.
 * These are common top-level and mid-level taxonomy IDs from Etsy's seller taxonomy.
 */
const INW_TO_ETSY_TAXONOMY: Record<string, { id: number; path: string }[]> = {
  Accessories: [
    { id: 77, path: "Accessories" },
  ],
  "Accessories > Hats & Caps": [
    { id: 262, path: "Accessories > Hats & Caps" },
  ],
  "Accessories > Scarves & Wraps": [
    { id: 264, path: "Accessories > Scarves & Wraps" },
  ],
  "Art & Collectibles": [
    { id: 1, path: "Art & Collectibles" },
  ],
  "Art & Collectibles > Paintings & Prints": [
    { id: 19, path: "Art & Collectibles > Painting" },
    { id: 21, path: "Art & Collectibles > Prints" },
  ],
  "Art & Collectibles > Photography": [
    { id: 18, path: "Art & Collectibles > Photography" },
  ],
  "Art & Collectibles > Sculpture & Statues": [
    { id: 23, path: "Art & Collectibles > Sculpture" },
  ],
  "Bags & Purses": [
    { id: 78, path: "Bags & Purses" },
  ],
  "Bath & Beauty": [
    { id: 79, path: "Bath & Beauty" },
  ],
  "Bath & Beauty > Skin Care": [
    { id: 375, path: "Bath & Beauty > Skin Care" },
  ],
  "Bath & Beauty > Soaps & Bath": [
    { id: 376, path: "Bath & Beauty > Soaps" },
  ],
  "Books, Movies & Music": [
    { id: 80, path: "Books, Films & Music" },
  ],
  Clothing: [
    { id: 81, path: "Clothing" },
  ],
  "Craft Supplies & Tools": [
    { id: 82, path: "Craft Supplies & Tools" },
  ],
  "Electronics & Accessories": [
    { id: 83, path: "Electronics & Accessories" },
  ],
  "Home & Living": [
    { id: 84, path: "Home & Living" },
  ],
  "Home & Living > Home Decor": [
    { id: 441, path: "Home & Living > Home Decor" },
  ],
  "Home & Living > Bedding": [
    { id: 428, path: "Home & Living > Bedding" },
  ],
  "Jewelry & Watches": [
    { id: 85, path: "Jewelry" },
  ],
  "Jewelry & Watches > Necklaces & Pendants": [
    { id: 485, path: "Jewelry > Necklaces" },
  ],
  "Jewelry & Watches > Earrings": [
    { id: 483, path: "Jewelry > Earrings" },
  ],
  "Jewelry & Watches > Bracelets": [
    { id: 481, path: "Jewelry > Bracelets" },
  ],
  "Jewelry & Watches > Rings": [
    { id: 487, path: "Jewelry > Rings" },
  ],
  "Paper & Party Supplies": [
    { id: 86, path: "Paper & Party Supplies" },
  ],
  "Paper & Party Supplies > Party Decorations": [
    { id: 524, path: "Paper & Party Supplies > Party Supplies" },
  ],
  "Paper & Party Supplies > Stickers & Labels": [
    { id: 528, path: "Paper & Party Supplies > Stickers, Labels & Tags" },
  ],
  "Pet Supplies": [
    { id: 87, path: "Pet Supplies" },
  ],
  Shoes: [
    { id: 88, path: "Shoes" },
  ],
  "Toys & Games": [
    { id: 89, path: "Toys & Games" },
  ],
  Wedding: [
    { id: 90, path: "Weddings" },
  ],
};

/**
 * Shopify uses product types (custom strings) and collections.
 * These are common product type suggestions.
 */
const INW_TO_SHOPIFY_PRODUCT_TYPES: Record<string, string[]> = {
  Accessories: ["Accessories", "Fashion Accessories"],
  "Art & Collectibles": ["Art", "Collectibles", "Home Decor"],
  "Bags & Purses": ["Bags", "Handbags", "Accessories"],
  "Bath & Beauty": ["Beauty", "Skincare", "Bath & Body"],
  "Books, Movies & Music": ["Books", "Media", "Entertainment"],
  Clothing: ["Clothing", "Apparel", "Fashion"],
  "Craft Supplies & Tools": ["Craft Supplies", "DIY", "Tools"],
  "Electronics & Accessories": ["Electronics", "Tech Accessories", "Gadgets"],
  Furniture: ["Furniture", "Home", "Living Room"],
  "Home & Living": ["Home Decor", "Home & Living", "Housewares"],
  "Home & Kitchen": ["Kitchen", "Kitchenware", "Home"],
  "Jewelry & Watches": ["Jewelry", "Watches", "Accessories"],
  "Paper & Party Supplies": ["Party Supplies", "Stationery", "Paper Goods"],
  "Pet Supplies": ["Pet Supplies", "Pets", "Animals"],
  Shoes: ["Shoes", "Footwear", "Fashion"],
  "Sports & Outdoors": ["Sports", "Outdoor", "Fitness"],
  "Toys & Games": ["Toys", "Games", "Kids"],
  Wedding: ["Wedding", "Bridal", "Events"],
  "Baby & Kids": ["Baby", "Kids", "Children"],
};

/**
 * Suggest provider categories based on INW item data.
 *
 * For eBay: Returns category ID suggestions that can be used with the eBay category picker.
 * For Etsy: Returns taxonomy ID suggestions.
 * For Shopify/Wix: Returns collection/product type suggestions.
 */
export async function suggestProviderCategories(
  item: { title: string; description?: string | null; category?: string | null; subcategory?: string | null },
  providers: ChannelProvider[],
  _connections?: ChannelConnectionContext[]
): Promise<SuggestCategoriesResult> {
  const result: SuggestCategoriesResult = {};
  const inwCategory = item.category?.trim() || null;
  const inwSubcategory = item.subcategory?.trim() || null;
  const fullCategoryKey = inwSubcategory
    ? `${inwCategory} > ${inwSubcategory}`
    : inwCategory;

  for (const provider of providers) {
    if (provider === "ebay") {
      result.ebay = suggestEbayCategories(item.title, fullCategoryKey, inwCategory);
    } else if (provider === "etsy") {
      result.etsy = suggestEtsyCategories(fullCategoryKey, inwCategory);
    } else if (provider === "shopify") {
      result.shopify = suggestShopifyCategories(fullCategoryKey, inwCategory);
    } else if (provider === "wix") {
      result.wix = suggestWixCategories(fullCategoryKey, inwCategory);
    }
  }

  return result;
}

function suggestEbayCategories(
  title: string,
  fullCategoryKey: string | null,
  inwCategory: string | null
): CategorySuggestion[] {
  const suggestions: CategorySuggestion[] = [];
  const seen = new Set<string>();

  if (fullCategoryKey && INW_TO_EBAY_CATEGORIES[fullCategoryKey]) {
    for (const cat of INW_TO_EBAY_CATEGORIES[fullCategoryKey]) {
      if (!seen.has(cat.id)) {
        seen.add(cat.id);
        suggestions.push({
          provider: "ebay",
          categoryId: cat.id,
          categoryPath: cat.path,
          confidence: 0.95,
        });
      }
    }
  }

  if (inwCategory && INW_TO_EBAY_CATEGORIES[inwCategory]) {
    for (const cat of INW_TO_EBAY_CATEGORIES[inwCategory]) {
      if (!seen.has(cat.id)) {
        seen.add(cat.id);
        suggestions.push({
          provider: "ebay",
          categoryId: cat.id,
          categoryPath: cat.path,
          confidence: 0.85,
        });
      }
    }
  }

  if (suggestions.length === 0 && title) {
    const titleLower = title.toLowerCase();
    for (const [inwCat, cats] of Object.entries(INW_TO_EBAY_CATEGORIES)) {
      const score = similarityScore(title, inwCat.split(" > ")[0]);
      if (score > 0.4) {
        for (const cat of cats.slice(0, 2)) {
          if (!seen.has(cat.id)) {
            seen.add(cat.id);
            suggestions.push({
              provider: "ebay",
              categoryId: cat.id,
              categoryPath: cat.path,
              confidence: Math.min(0.7, score),
            });
          }
        }
      }
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

function suggestEtsyCategories(
  fullCategoryKey: string | null,
  inwCategory: string | null
): CategorySuggestion[] {
  const suggestions: CategorySuggestion[] = [];
  const seen = new Set<number>();

  if (fullCategoryKey && INW_TO_ETSY_TAXONOMY[fullCategoryKey]) {
    for (const tax of INW_TO_ETSY_TAXONOMY[fullCategoryKey]) {
      if (!seen.has(tax.id)) {
        seen.add(tax.id);
        suggestions.push({
          provider: "etsy",
          categoryId: tax.id,
          categoryPath: tax.path,
          confidence: 0.95,
        });
      }
    }
  }

  if (inwCategory && INW_TO_ETSY_TAXONOMY[inwCategory]) {
    for (const tax of INW_TO_ETSY_TAXONOMY[inwCategory]) {
      if (!seen.has(tax.id)) {
        seen.add(tax.id);
        suggestions.push({
          provider: "etsy",
          categoryId: tax.id,
          categoryPath: tax.path,
          confidence: 0.85,
        });
      }
    }
  }

  if (suggestions.length === 0 && inwCategory) {
    for (const [inwCat, taxes] of Object.entries(INW_TO_ETSY_TAXONOMY)) {
      const score = similarityScore(inwCategory, inwCat.split(" > ")[0]);
      if (score > 0.5) {
        for (const tax of taxes.slice(0, 1)) {
          if (!seen.has(tax.id)) {
            seen.add(tax.id);
            suggestions.push({
              provider: "etsy",
              categoryId: tax.id,
              categoryPath: tax.path,
              confidence: Math.min(0.7, score),
            });
          }
        }
      }
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

function suggestShopifyCategories(
  fullCategoryKey: string | null,
  inwCategory: string | null
): CategorySuggestion[] {
  const suggestions: CategorySuggestion[] = [];
  const types = new Set<string>();

  const addTypes = (key: string, confidence: number) => {
    const productTypes = INW_TO_SHOPIFY_PRODUCT_TYPES[key];
    if (productTypes) {
      for (const pt of productTypes) {
        if (!types.has(pt)) {
          types.add(pt);
          suggestions.push({
            provider: "shopify",
            categoryId: pt,
            categoryPath: pt,
            confidence,
          });
        }
      }
    }
  };

  if (fullCategoryKey) {
    const baseKey = fullCategoryKey.split(" > ")[0];
    addTypes(baseKey, 0.9);
  }
  if (inwCategory) {
    addTypes(inwCategory, 0.85);
  }

  return suggestions.slice(0, 5);
}

function suggestWixCategories(
  fullCategoryKey: string | null,
  inwCategory: string | null
): CategorySuggestion[] {
  return suggestShopifyCategories(fullCategoryKey, inwCategory).map((s) => ({
    ...s,
    provider: "wix",
  }));
}

/**
 * Get suggested INW category based on title keywords.
 * Used for auto-suggesting INW categories when creating new listings.
 */
export function suggestInwCategoryFromTitle(title: string): {
  category: string;
  subcategory: string | null;
  confidence: number;
} | null {
  if (!title?.trim()) return null;

  const titleLower = title.toLowerCase();
  let best: { category: string; subcategory: string | null; score: number } | null = null;

  const categoryKeywords: Record<string, string[]> = {
    "Art & Collectibles": ["art", "collectible", "vintage", "antique", "coin", "card", "painting", "print", "sculpture"],
    Accessories: ["hat", "scarf", "belt", "sunglasses", "gloves", "keychain", "pin", "badge"],
    "Bags & Purses": ["bag", "purse", "handbag", "backpack", "wallet", "tote"],
    "Bath & Beauty": ["soap", "lotion", "skincare", "makeup", "cosmetic", "beauty", "fragrance", "perfume"],
    "Books, Movies & Music": ["book", "dvd", "cd", "vinyl", "record", "music", "movie", "film"],
    Clothing: ["shirt", "dress", "pants", "jacket", "coat", "sweater", "blouse", "skirt", "jeans"],
    "Craft Supplies & Tools": ["craft", "supply", "yarn", "fabric", "bead", "tool", "diy"],
    "Electronics & Accessories": ["phone", "charger", "cable", "headphone", "speaker", "electronic", "tech"],
    Furniture: ["table", "chair", "desk", "shelf", "cabinet", "sofa", "couch", "furniture"],
    "Home & Living": ["decor", "pillow", "candle", "vase", "rug", "curtain", "wall art"],
    "Home & Kitchen": ["kitchen", "bowl", "plate", "cup", "mug", "utensil", "cookware"],
    "Jewelry & Watches": ["necklace", "bracelet", "earring", "ring", "watch", "jewelry", "jewellery"],
    "Paper & Party Supplies": ["card", "invitation", "sticker", "party", "banner", "decoration"],
    "Pet Supplies": ["pet", "dog", "cat", "collar", "leash", "toy pet"],
    Shoes: ["shoe", "boot", "sneaker", "sandal", "heel", "loafer"],
    "Sports & Outdoors": ["sport", "outdoor", "camping", "hiking", "fitness", "exercise", "gym"],
    "Toys & Games": ["toy", "game", "puzzle", "doll", "action figure", "board game"],
    Wedding: ["wedding", "bridal", "bride", "engagement"],
    "Baby & Kids": ["baby", "toddler", "kids", "children", "infant", "nursery"],
  };

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    for (const keyword of keywords) {
      if (titleLower.includes(keyword)) {
        const score = keyword.length / title.length + 0.5;
        if (!best || score > best.score) {
          best = { category, subcategory: null, score: Math.min(score, 0.9) };
        }
      }
    }
  }

  for (const preset of STORE_CATEGORIES) {
    const labelScore = similarityScore(title, preset.label);
    if (labelScore > 0.5 && (!best || labelScore > best.score)) {
      best = { category: preset.label, subcategory: null, score: labelScore };
    }

    for (const sub of preset.subcategories) {
      const subScore = similarityScore(title, sub);
      if (subScore > 0.5 && (!best || subScore > best.score)) {
        best = { category: preset.label, subcategory: sub, score: subScore };
      }
    }
  }

  if (!best || best.score < 0.3) return null;

  return {
    category: best.category,
    subcategory: best.subcategory,
    confidence: best.score,
  };
}

/**
 * Map INW category to provider-specific category/taxonomy ID for outbound sync.
 * Returns the best single match for each provider.
 */
export function getOutboundCategoryMapping(
  inwCategory: string | null,
  inwSubcategory: string | null,
  provider: ChannelProvider
): { categoryId: string | number; categoryPath: string } | null {
  if (!inwCategory) return null;

  const fullKey = inwSubcategory ? `${inwCategory} > ${inwSubcategory}` : inwCategory;

  if (provider === "ebay") {
    const cats = INW_TO_EBAY_CATEGORIES[fullKey] || INW_TO_EBAY_CATEGORIES[inwCategory];
    const cat = cats?.[0];
    return cat ? { categoryId: cat.id, categoryPath: cat.path } : null;
  }

  if (provider === "etsy") {
    const taxes = INW_TO_ETSY_TAXONOMY[fullKey] || INW_TO_ETSY_TAXONOMY[inwCategory];
    const tax = taxes?.[0];
    return tax ? { categoryId: tax.id, categoryPath: tax.path } : null;
  }

  if (provider === "shopify" || provider === "wix") {
    const types = INW_TO_SHOPIFY_PRODUCT_TYPES[inwCategory];
    return types?.[0] ? { categoryId: types[0], categoryPath: types[0] } : null;
  }

  return null;
}
