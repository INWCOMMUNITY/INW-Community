import type { ChannelConnectionContext, SyncStoreItem } from "../types";
import { cacheProviderCategoryId, getCategoryMap } from "../category-map";
import { shopifyProductTypeForInw } from "../category-suggest";
import { ShopifyApiError, shopifyGraphql } from "./client";
import { readShopifyConfig } from "./config";
import { assignShopifyProductCollection, ensureShopifyCollection } from "./collections";

function gid(id: string): string {
  return `gid://shopify/TaxonomyCategory/${id}`;
}

function mapKey(category: string, subcategory?: string | null): string {
  const cat = category.trim();
  const sub = subcategory?.trim();
  return sub ? `${cat} > ${sub}` : cat;
}

/**
 * Static INW → Shopify Standard Product Taxonomy GIDs (2026-11 taxonomy file).
 * Unlisted leaves fall through to live `taxonomy { categories(search:) }` lookup.
 */
const INW_TO_SHOPIFY_TAXONOMY_GID: Record<string, string> = {
  Accessories: gid("aa-2"),
  Clothing: gid("aa-1"),
  "Bags & Purses": gid("aa-5"),
  "Jewelry & Watches": gid("aa-6"),
  Shoes: gid("aa-8"),
  "Art & Collectibles": gid("ae-2-2"),
  "Craft Supplies & Tools": gid("ae-2-1"),
  "Musical Instruments": gid("ae-2-8"),
  "Paper & Party Supplies": gid("ae-3"),
  "Tickets & Experiences": gid("ae-1"),
  "Baby & Kids": gid("bt"),
  "Business & Industrial": gid("bi"),
  "Electronics & Accessories": gid("el"),
  "Electronics & Accessories > Gaming Consoles & Accessories": gid("el-18"),
  "Electronics & Accessories > Gaming": gid("el-7-9-12-5"),
  "Video Games & Consoles": gid("el-19"),
  "Video Games & Consoles > Consoles": gid("el-19-2"),
  "Video Games & Consoles > Handhelds": gid("el-19-1"),
  "Video Games & Consoles > Controllers & Accessories": gid("el-18-5"),
  "Video Games & Consoles > PC Gaming": gid("el-7-9-12-5"),
  "Food & Drink": gid("fb-2"),
  "Food & Drink > Baked Goods": gid("fb-2-1"),
  "Food & Drink > Jams, Honey & Preserves": gid("fb-2-7-6"),
  "Food & Drink > Coffee & Tea": gid("fb-1-3"),
  "Food & Drink > Spices & Seasonings": gid("fb-2-16"),
  "Food & Drink > Candy & Chocolate": gid("fb-2-3"),
  "Food & Drink > Pantry & Packaged": gid("fb-2"),
  Furniture: gid("fr"),
  "Home & Garden": gid("hg"),
  "Home & Kitchen": gid("hg-11"),
  "Luggage & Travel": gid("lb"),
  "Luggage & Travel > Travel Accessories": gid("lb-9"),
  "Books, Movies & Music": gid("me"),
  "Office & School Supplies": gid("os"),
  "Office & School Supplies > Office Supplies": gid("os-4"),
  "Sports & Outdoors": gid("sg"),
  "Sports & Outdoors > Camping & Hiking": gid("sg-4-2"),
  "Sports & Outdoors > Cycling": gid("sg-4-4"),
  "Sports & Outdoors > Water Sports": gid("sg-4-1"),
  "Toys & Games": gid("tg"),
  "Vehicles & Parts": gid("vp"),
  "Vehicles & Parts > Car & Truck Parts": gid("vp"),
  "Bath & Beauty": gid("hb"),
  "Health & Personal Care": gid("hb-1"),
  "Pet Supplies": gid("ap-2"),
  "Tools & Home Improvement": gid("ha"),
  Wedding: gid("ae-3"),
};

const TAXONOMY_SEARCH_QUERY = `
  query TaxonomySearch($q: String!) {
    taxonomy {
      categories(first: 8, search: $q) {
        nodes { id name fullName }
      }
    }
  }
`;

type TaxonomySearchData = {
  taxonomy?: {
    categories?: {
      nodes?: { id?: string; name?: string; fullName?: string }[];
    };
  };
};

export function shopifyTaxonomyGidForInw(
  category: string | null | undefined,
  subcategory?: string | null
): string | null {
  const cat = category?.trim();
  if (!cat) return null;
  const full = mapKey(cat, subcategory);
  return INW_TO_SHOPIFY_TAXONOMY_GID[full] ?? INW_TO_SHOPIFY_TAXONOMY_GID[cat] ?? null;
}

function taxonomySearchTerm(category: string, subcategory?: string | null): string {
  const sub = subcategory?.trim();
  if (sub && !sub.toLowerCase().startsWith("other ")) return sub;
  return category;
}

async function searchShopifyTaxonomyGid(
  accessToken: string,
  shop: string,
  apiVersion: string,
  term: string
): Promise<string | null> {
  const q = term.trim();
  if (!q) return null;
  try {
    const data = await shopifyGraphql<TaxonomySearchData>(
      accessToken,
      shop,
      apiVersion,
      TAXONOMY_SEARCH_QUERY,
      { q }
    );
    const nodes = data.taxonomy?.categories?.nodes ?? [];
    const hit = nodes.find((n) => n.id?.startsWith("gid://shopify/TaxonomyCategory/"));
    return hit?.id ?? null;
  } catch (e) {
    console.warn("[shopify] taxonomy search failed", { term: q, error: String(e) });
    return null;
  }
}

async function resolveTaxonomyGid(
  conn: ChannelConnectionContext,
  shop: string,
  apiVersion: string,
  category: string,
  subcategory: string | null
): Promise<string | null> {
  const cacheLabel = mapKey(category, subcategory);
  const cached = getCategoryMap(conn.config)[cacheLabel.toLowerCase()]?.shopifyTaxonomyGid;
  if (cached) return cached;

  let gidValue = shopifyTaxonomyGidForInw(category, subcategory);
  if (!gidValue) {
    gidValue = await searchShopifyTaxonomyGid(
      conn.accessToken,
      shop,
      apiVersion,
      taxonomySearchTerm(category, subcategory)
    );
  }
  if (gidValue) {
    await cacheProviderCategoryId(conn, cacheLabel, { shopifyTaxonomyGid: gidValue }).catch(() => {});
  }
  return gidValue;
}

const PRODUCT_UPDATE_INPUT = `
  mutation ProductUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id category { id } productType }
      userErrors { field message }
    }
  }
`;

const PRODUCT_UPDATE_PRODUCT = `
  mutation ProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id category { id } productType }
      userErrors { field message }
    }
  }
`;

type ProductUpdateData = {
  productUpdate?: {
    product?: { id?: string } | null;
    userErrors?: { field?: string[]; message?: string }[];
  };
};

async function productUpdateCategory(
  accessToken: string,
  shop: string,
  apiVersion: string,
  productGid: string,
  categoryGid: string,
  productType: string | undefined
): Promise<void> {
  const input = {
    id: productGid,
    category: categoryGid,
    ...(productType ? { productType } : {}),
  };
  try {
    const data = await shopifyGraphql<ProductUpdateData>(
      accessToken,
      shop,
      apiVersion,
      PRODUCT_UPDATE_INPUT,
      { input }
    );
    const err = data.productUpdate?.userErrors?.find((e) => e.message?.trim());
    if (err?.message) throw new Error(err.message);
    return;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/ProductInput|unknown argument|input/i.test(msg)) throw e;
  }
  const data = await shopifyGraphql<ProductUpdateData>(
    accessToken,
    shop,
    apiVersion,
    PRODUCT_UPDATE_PRODUCT,
    { product: input }
  );
  const err = data.productUpdate?.userErrors?.find((e) => e.message?.trim());
  if (err?.message) throw new Error(err.message);
}

/**
 * Best-effort Shopify Category (Standard Product Taxonomy) + custom collection.
 * Never throws — publish/update must succeed even if taxonomy or collections fail.
 */
export async function applyShopifyCategory(
  conn: ChannelConnectionContext,
  productId: string,
  item: SyncStoreItem
): Promise<void> {
  const cfg = readShopifyConfig(conn.config, conn.externalShopId);
  if (!cfg.shop || !productId) return;
  const category = item.category?.trim() || null;
  const subcategory = item.subcategory?.trim() || null;
  const productType = shopifyProductTypeForInw(category, subcategory);
  const productGid = productId.startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;

  try {
    if (category) {
      const taxonomyGid = await resolveTaxonomyGid(
        conn,
        cfg.shop,
        cfg.apiVersion,
        category,
        subcategory
      );
      if (taxonomyGid) {
        await productUpdateCategory(
          conn.accessToken,
          cfg.shop,
          cfg.apiVersion,
          productGid,
          taxonomyGid,
          productType
        );
      }
    }
  } catch (e) {
    console.warn("[shopify] taxonomy category apply failed", {
      productId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const collectionName = category;
  if (!collectionName) return;
  try {
    const collectionId = await ensureShopifyCollection(
      conn.accessToken,
      cfg.shop,
      cfg.apiVersion,
      collectionName
    );
    if (collectionId) {
      await assignShopifyProductCollection(
        conn.accessToken,
        cfg.shop,
        cfg.apiVersion,
        productId.replace(/^gid:\/\/shopify\/Product\//, ""),
        collectionId
      );
    }
  } catch (e) {
    if (e instanceof ShopifyApiError && (e.status === 401 || e.status === 403)) return;
    console.warn("[shopify] collection assign failed", {
      productId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
