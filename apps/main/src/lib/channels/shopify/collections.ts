import { ShopifyApiError, shopifyGet, shopifyJson } from "./client";

const SHOPIFY_COLLECTION_NOISE = new Set([
  "all",
  "all products",
  "frontpage",
  "home",
  "homepage",
  "home page",
  "new arrivals",
  "best sellers",
  "bestsellers",
  "sale",
  "on sale",
  "featured",
  "shop all",
  "catalog",
  "products",
]);

export function isShopifyCollectionNoise(label: string | null | undefined): boolean {
  const n = (label ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!n) return true;
  return SHOPIFY_COLLECTION_NOISE.has(n);
}

export const isShopifyNoiseCollectionTitle = isShopifyCollectionNoise;

type CustomCollection = { id?: number; title?: string | null };
type SmartCollection = { id?: number; title?: string | null };
type Collect = { product_id?: number; collection_id?: number };

function isCollectionScopeError(e: unknown): boolean {
  return e instanceof ShopifyApiError && (e.status === 401 || e.status === 403);
}

async function listCollectionTitles(
  accessToken: string,
  shop: string,
  apiVersion: string
): Promise<{ id: number; title: string }[]> {
  const out: { id: number; title: string }[] = [];
  try {
    const custom = await shopifyGet<{ custom_collections?: CustomCollection[] }>(
      accessToken,
      shop,
      apiVersion,
      "/custom_collections.json?limit=250"
    );
    for (const c of custom.custom_collections ?? []) {
      if (c.id != null && c.title?.trim()) out.push({ id: c.id, title: c.title.trim() });
    }
  } catch (e) {
    if (isCollectionScopeError(e)) return [];
    console.warn("[shopify] list custom collections failed", { error: String(e) });
  }
  try {
    const smart = await shopifyGet<{ smart_collections?: SmartCollection[] }>(
      accessToken,
      shop,
      apiVersion,
      "/smart_collections.json?limit=250"
    );
    for (const c of smart.smart_collections ?? []) {
      if (c.id != null && c.title?.trim()) out.push({ id: c.id, title: c.title.trim() });
    }
  } catch (e) {
    if (isCollectionScopeError(e)) return out;
    console.warn("[shopify] list smart collections failed", { error: String(e) });
  }
  return out;
}

/** First non-noise collection title per product id (custom collections preferred). */
export async function fetchShopifyCollectionCategoryMaps(
  accessToken: string,
  shop: string,
  apiVersion: string
): Promise<Map<string, string>> {
  const categoryByProductId = new Map<string, string>();
  const collections = await listCollectionTitles(accessToken, shop, apiVersion);
  let fetched = 0;
  for (const col of collections) {
    if (fetched >= 50) break;
    if (isShopifyCollectionNoise(col.title)) continue;
    fetched += 1;
    try {
      const res = await shopifyGet<{ collects?: Collect[] }>(
        accessToken,
        shop,
        apiVersion,
        `/collects.json?collection_id=${col.id}&limit=250`
      );
      for (const row of res.collects ?? []) {
        if (row.product_id == null) continue;
        const pid = String(row.product_id);
        if (!categoryByProductId.has(pid)) {
          categoryByProductId.set(pid, col.title);
        }
      }
    } catch (e) {
      if (isCollectionScopeError(e)) break;
      console.warn("[shopify] list collects failed", { collectionId: col.id, error: String(e) });
    }
  }
  return categoryByProductId;
}

export async function ensureShopifyCollection(
  accessToken: string,
  shop: string,
  apiVersion: string,
  name: string
): Promise<number | null> {
  const title = name.trim().slice(0, 80);
  if (!title) return null;
  try {
    const listed = await shopifyGet<{ custom_collections?: CustomCollection[] }>(
      accessToken,
      shop,
      apiVersion,
      `/custom_collections.json?title=${encodeURIComponent(title)}&limit=50`
    );
    const existing = listed.custom_collections?.find(
      (c) => c.id != null && c.title?.trim().toLowerCase() === title.toLowerCase()
    );
    if (existing?.id != null) return existing.id;

    const created = await shopifyJson<{ custom_collection?: CustomCollection }>(
      accessToken,
      shop,
      apiVersion,
      "/custom_collections.json",
      "POST",
      { custom_collection: { title } }
    );
    return created.custom_collection?.id ?? null;
  } catch (e) {
    if (isCollectionScopeError(e)) return null;
    console.warn("[shopify] ensureShopifyCollection failed", { title, error: String(e) });
    return null;
  }
}

export async function assignShopifyProductCollection(
  accessToken: string,
  shop: string,
  apiVersion: string,
  productId: string,
  collectionId: number
): Promise<boolean> {
  const pid = Number(productId);
  if (!Number.isFinite(pid) || collectionId <= 0) return false;
  try {
    const existing = await shopifyGet<{ collects?: Collect[] }>(
      accessToken,
      shop,
      apiVersion,
      `/collects.json?product_id=${pid}&limit=250`
    );
    if ((existing.collects ?? []).some((c) => c.collection_id === collectionId)) {
      return true;
    }
    await shopifyJson(
      accessToken,
      shop,
      apiVersion,
      "/collects.json",
      "POST",
      { collect: { product_id: pid, collection_id: collectionId } }
    );
    return true;
  } catch (e) {
    if (isCollectionScopeError(e)) return false;
    console.warn("[shopify] assignShopifyProductCollection failed", {
      productId,
      collectionId,
      error: String(e),
    });
    return false;
  }
}
