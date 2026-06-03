import type {
  ChannelAdapter,
  ChannelConnectionContext,
  CreateListingResult,
  RemoteListingSummary,
  RemoteSale,
  SyncStoreItem,
  TokenResponse,
} from "../types";
import { WixApiError, wixDelete, wixGet, wixJson, type WixRequestOpts } from "./client";
import { getWixConfig } from "./config";
import { exchangeWixCode, fetchWixShopInfo, getWixAuthUrl, refreshWixToken } from "./oauth";
import {
  catalogApiFromListStrategy,
  persistWixCatalogApi,
  refreshCatalogVersionAfterMismatch,
  resolveWixCatalogMode,
  type WixCatalogMode,
} from "./catalog-api";
import {
  ensureWixSiteId,
  remintWixAccessToken,
  wixInventoryRequestOpts,
  wixSiteIdFromConn,
} from "./site";
import { isWixMetasiteContextError } from "./client";
import { resolveProviderCategoryId } from "../category-map";
import { assertSaneInventoryQty } from "../inventory-sanity";
import { hasOptionQuantities, sumOptionQuantities } from "../../store-item-variants";
import {
  assignWixProductCollection,
  attachWixVariantsToSummary,
  ensureWixCollection,
  fetchWixV1Product,
  mergeV2InventoryIntoV1Product,
  pushWixV1OptionsUpdate,
  pushWixV1PerOptionInventory,
  wixV1ProductToVariants,
} from "./collections";
import {
  buildWixCreateBody,
  buildWixUpdateBody,
  buildWixV1CreateBody,
  buildWixV1InventoryOnlyBody,
  buildWixV1UpdateBody,
  isWixProductVisibleOnSite,
  v1Quantity,
  wixProductToSummary,
  wixV1ProductToSummary,
  type WixProduct,
  type WixV1Product,
} from "./mapping";
import { syncWixProductMedia } from "./media";

type ProductResponse = { product?: WixProduct };
type ProductsQueryResponse = {
  products?: WixProduct[];
  pagingMetadata?: { cursors?: { next?: string | null } };
};
type V1ProductsQueryResponse = {
  products?: WixV1Product[];
  metadata?: { items?: number; offset?: number };
};
type InventoryItem = {
  id?: string;
  revision?: string;
  quantity?: number;
  inStock?: boolean;
  trackQuantity?: boolean;
  productId?: string;
  locationId?: string;
};
type InventorySearchResponse = { inventoryItems?: InventoryItem[] };

function wixOpts(conn: ChannelConnectionContext): WixRequestOpts {
  const siteId = wixSiteIdFromConn(conn);
  return siteId ? { siteId } : {};
}

/** Site id + official catalog version (v1 vs v3) before any Stores catalog API. */
async function prepareWixConn(conn: ChannelConnectionContext): Promise<WixCatalogMode> {
  await ensureWixSiteId(conn);
  return resolveWixCatalogMode(conn);
}

/** Optional Stores location to scope inventory reads/writes (defaults to the site default). */
function defaultLocationId(): string | null {
  try {
    return getWixConfig().defaultLocationId;
  } catch {
    return null;
  }
}

/** Fetch a product (revision + variant id are required for updates). */
async function getProduct(
  accessToken: string,
  productId: string,
  opts: WixRequestOpts
): Promise<WixProduct | null> {
  try {
    const res = await wixGet<ProductResponse>(
      accessToken,
      `/stores/v3/products/${encodeURIComponent(productId)}?fields=MEDIA_ITEMS_INFO&fields=PLAIN_DESCRIPTION`,
      opts
    );
    return res.product ?? null;
  } catch (e) {
    if (e instanceof WixApiError && e.status === 404) return null;
    throw e;
  }
}

async function searchInventoryChunk(
  accessToken: string,
  productIds: string[],
  opts: WixRequestOpts
): Promise<InventoryItem[]> {
  if (productIds.length === 0) return [];
  const filter: Record<string, unknown> =
    productIds.length === 1
      ? { productId: { $eq: productIds[0] } }
      : { productId: { $in: productIds } };
  const loc = defaultLocationId();
  if (loc) filter.locationId = { $eq: loc };
  const res = await wixJson<InventorySearchResponse>(
    accessToken,
    `/stores/v3/inventory-items/search`,
    "POST",
    {
      search: {
        filter,
        cursorPaging: { limit: Math.min(200, productIds.length * 5 || 100) },
      },
    },
    opts
  ).catch(() => null);
  return res?.inventoryItems ?? [];
}

/**
 * Resolve inventory items for products (chunked — Wix filters have practical limits).
 */
async function searchInventoryItems(
  accessToken: string,
  productIds: string[],
  opts: WixRequestOpts
): Promise<InventoryItem[]> {
  const CHUNK = 25;
  const all: InventoryItem[] = [];
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const batch = await searchInventoryChunk(accessToken, productIds.slice(i, i + CHUNK), opts);
    all.push(...batch);
  }
  return all;
}

// Page caps high enough to cover large catalogs; truncation would wrongly mark items "removed".
const WIX_MAX_PAGES = 200;

/** Catalog v3 — used on newer Stores catalogs. */
async function queryAllProductsV3(accessToken: string, opts: WixRequestOpts): Promise<WixProduct[]> {
  const products: WixProduct[] = [];
  let cursor: string | undefined;
  let truncated = true;
  for (let page = 0; page < WIX_MAX_PAGES; page++) {
    const res = await wixJson<ProductsQueryResponse>(
      accessToken,
      `/stores/v3/products/query`,
      "POST",
      {
        fields: ["MEDIA_ITEMS_INFO", "CURRENCY", "PLAIN_DESCRIPTION"],
        query: {
          cursorPaging: { limit: 100, ...(cursor ? { cursor } : {}) },
        },
      },
      opts
    );
    const page_products = res.products ?? [];
    // Hidden products (visible === false) are treated as removed on INW, same as Catalog v1.
    const batch = page_products.filter((p) => p.id && isWixProductVisibleOnSite(p));
    products.push(...batch);
    const next = res.pagingMetadata?.cursors?.next;
    if (!next || page_products.length === 0) {
      truncated = false;
      break;
    }
    cursor = next;
  }
  if (truncated) {
    console.warn("[wix] queryAllProductsV3 hit page cap — catalog may be truncated", {
      pages: WIX_MAX_PAGES,
      fetched: products.length,
    });
  }
  return products;
}

/** Catalog v1 — classic Wix Editor + Wix Stores (`/stores/v1` or `/stores-reader/v1`). */
async function queryAllProductsV1(
  accessToken: string,
  path: "/stores/v1/products/query" | "/stores-reader/v1/products/query",
  opts: WixRequestOpts
): Promise<RemoteListingSummary[]> {
  const summaries: RemoteListingSummary[] = [];
  let offset = 0;
  let truncated = true;
  for (let page = 0; page < WIX_MAX_PAGES; page++) {
    const res = await wixJson<V1ProductsQueryResponse>(
      accessToken,
      path,
      "POST",
      {
        includeVariants: true,
        query: { paging: { limit: 100, offset } },
      },
      opts
    );
    const pageProducts = res.products ?? [];
    const batch = pageProducts.filter((p) => p.id && isWixProductVisibleOnSite(p));
    for (const p of batch) {
      if (p.id) {
        await mergeV2InventoryIntoV1Product(accessToken, p.id, p, opts);
      }
      const s = wixV1ProductToSummary(p);
      attachWixVariantsToSummary(s, p);
      // List query sometimes omits productOptions; GET fills them in for option products.
      if (!s.variantsKnown && p.id && (p.manageVariants || (p.variants?.length ?? 0) > 1)) {
        const full = await fetchWixV1Product(accessToken, p.id, opts);
        if (full) attachWixVariantsToSummary(s, full);
      }
      if (s.externalListingId) summaries.push(s);
    }
    if (pageProducts.length < 100) {
      truncated = false;
      break;
    }
    offset += pageProducts.length;
  }
  if (truncated) {
    console.warn("[wix] queryAllProductsV1 hit page cap — catalog may be truncated", {
      pages: WIX_MAX_PAGES,
      path,
      fetched: summaries.length,
    });
  }
  return summaries;
}

async function listRemoteListingsV3(
  accessToken: string,
  opts: WixRequestOpts
): Promise<RemoteListingSummary[]> {
  const products = await queryAllProductsV3(accessToken, opts);
  const byProduct = new Map<string, InventoryItem[]>();
  const items = await searchInventoryItems(
    accessToken,
    products.map((p) => p.id as string),
    opts
  );
  for (const it of items) {
    if (!it.productId) continue;
    const list = byProduct.get(it.productId) ?? [];
    list.push(it);
    byProduct.set(it.productId, list);
  }
  return products
    .map((p) => {
      const summary = wixProductToSummary(p);
      const invItems = byProduct.get(p.id as string);
      return invItems
        ? { ...summary, quantity: quantityForProduct(invItems), quantityKnown: true }
        : summary;
    })
    .filter((s) => s.externalListingId);
}

/** Available quantity for a product: sum tracked quantities, else infer from inStock flag. */
function quantityForProduct(items: InventoryItem[]): number {
  let total = 0;
  let sawTracked = false;
  let inStock = false;
  for (const it of items) {
    if (typeof it.quantity === "number") {
      total += it.quantity;
      sawTracked = true;
    } else if (it.inStock) {
      inStock = true;
    }
  }
  if (sawTracked) return Math.max(0, total);
  return inStock ? 1 : 0;
}

/** Fallback when Catalog v3 inventory rows are missing (common on classic / v1 catalogs). */
async function setInventoryViaProductPatchV3(
  accessToken: string,
  productId: string,
  quantity: number,
  opts: WixRequestOpts
): Promise<boolean> {
  try {
    const product = await getProduct(accessToken, productId, opts);
    if (!product?.revision) return false;
    const variantId = product.variantsInfo?.variants?.[0]?.id ?? null;
    // trackQuantity must be true or Wix treats the variant as always-in-stock and ignores quantity.
    const variant: Record<string, unknown> = {
      inventoryItem: { trackQuantity: true, quantity, inStock: quantity > 0 },
    };
    if (variantId) variant.id = variantId;
    await wixJson(
      accessToken,
      `/stores/v3/products/${encodeURIComponent(productId)}`,
      "PATCH",
      { product: { revision: product.revision, variantsInfo: { variants: [variant] } } },
      opts
    );
    return true;
  } catch {
    return false;
  }
}

const WIX_DEFAULT_VARIANT_ID = "00000000-0000-0000-0000-000000000000";

type V2InventoryItem = {
  id?: string;
  productId?: string;
  trackQuantity?: boolean;
  variants?: { variantId?: string; quantity?: number; inStock?: boolean }[];
};

/**
 * Catalog v1 inventory uses Stores v2 `updateInventoryVariants` (not v3 inventory-items).
 * @see https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v1/inventory/update-inventory-variants
 */
async function setInventoryViaStoresV2(
  accessToken: string,
  productId: string,
  quantity: number,
  opts: WixRequestOpts
): Promise<boolean> {
  const qty = Math.max(0, Math.round(quantity));

  // Resolve the inventory item id + variant GUIDs. The GET-by-product can 404 or return an
  // unexpected shape on some classic sites, so it must not abort the write.
  let inventoryItemId: string | undefined;
  let variantIds: string[] = [];
  const got = await wixGet<{ inventoryItem?: V2InventoryItem }>(
    accessToken,
    `/stores/v2/inventoryItems/product/${encodeURIComponent(productId)}`,
    opts
  ).catch(() => null);
  if (got?.inventoryItem) {
    inventoryItemId = got.inventoryItem.id;
    variantIds =
      got.inventoryItem.variants?.map((v) => v.variantId).filter((id): id is string => Boolean(id)) ??
      [];
  }

  // Multi-option products need their real variant GUIDs or the update matches nothing (silent
  // no-op). Single (no-option) products use Wix's all-zero default variant id.
  if (variantIds.length === 0) {
    const prod = await wixGet<{ product?: WixV1Product }>(
      accessToken,
      `/stores/v1/products/${encodeURIComponent(productId)}`,
      opts
    ).catch(() => null);
    variantIds =
      prod?.product?.variants?.map((v) => v.id).filter((id): id is string => Boolean(id)) ?? [];
  }

  if (variantIds.length > 1) {
    throw new WixApiError(
      "Cannot set the same aggregate quantity on every Wix variant; use per-option inventory sync.",
      400,
      null
    );
  }

  const variants = (variantIds.length > 0 ? variantIds : [WIX_DEFAULT_VARIANT_ID]).map(
    (variantId) => ({ variantId, quantity: qty, inStock: qty > 0 })
  );

  await wixJson(
    accessToken,
    `/stores/v2/inventoryItems/product/${encodeURIComponent(productId)}`,
    "PATCH",
    {
      inventoryItem: {
        ...(inventoryItemId ? { id: inventoryItemId } : {}),
        productId,
        trackQuantity: true,
        variants,
      },
    },
    opts
  );
  return true;
}

/** Catalog v1 product PATCH — fallback when v2 inventory row is missing. */
async function setInventoryViaStoresV1(
  accessToken: string,
  productId: string,
  quantity: number,
  opts: WixRequestOpts
): Promise<boolean> {
  const got = await wixGet<{ product?: WixV1Product }>(
    accessToken,
    `/stores/v1/products/${encodeURIComponent(productId)}`,
    opts
  );
  if (!got.product) return false;
  const body = buildWixV1InventoryOnlyBody(quantity, got.product);
  if (!body) return false;
  await wixJson(
    accessToken,
    `/stores/v1/products/${encodeURIComponent(productId)}`,
    "PATCH",
    body,
    opts
  );
  return true;
}

/** Read absolute stock for one product (classic v2/v1 first, then v3 inventory search). */
export async function readWixProductQuantity(
  accessToken: string,
  productId: string,
  opts: WixRequestOpts,
  v1Only = false
): Promise<{ quantity: number; known: boolean }> {
  try {
    const inv = await wixGet<{
      inventoryItem?: { variants?: { quantity?: number; inStock?: boolean }[] };
    }>(accessToken, `/stores/v2/inventoryItems/product/${encodeURIComponent(productId)}`, opts);
    const variants = inv.inventoryItem?.variants ?? [];
    if (variants.length > 1) {
      // Summing per-variant quantities inflates totals for multi-option products.
    } else {
      let total = 0;
      let sawQty = false;
      let inStock = false;
      for (const v of variants) {
        if (typeof v.quantity === "number") {
          total += v.quantity;
          sawQty = true;
        } else if (v.inStock) inStock = true;
      }
      if (sawQty) return { quantity: Math.max(0, total), known: true };
      if (variants.length > 0) return { quantity: inStock ? 1 : 0, known: true };
    }
  } catch {
    /* try v1 product */
  }

  try {
    const got = await wixGet<{ product?: WixV1Product }>(
      accessToken,
      `/stores/v1/products/${encodeURIComponent(productId)}`,
      opts
    );
    if (got.product) {
      return { quantity: v1Quantity(got.product), known: true };
    }
  } catch {
    /* try v3 only when allowed */
  }

  if (v1Only) return { quantity: 0, known: false };

  const items = await searchInventoryItems(accessToken, [productId], opts);
  if (items.length > 0) {
    return { quantity: quantityForProduct(items), known: true };
  }

  const product = await getProduct(accessToken, productId, opts);
  if (product) {
    const inStock = product.inventory?.availabilityStatus !== "OUT_OF_STOCK";
    return { quantity: inStock ? 0 : 0, known: false };
  }

  return { quantity: 0, known: false };
}

/**
 * Read stock back after a write to confirm it applied. Returns ok=true when the read is unavailable
 * (cannot disprove the write) so we don't raise false errors on catalogs we can't read.
 */
async function readWixPerOptionAggregateQuantity(
  accessToken: string,
  productId: string,
  opts: WixRequestOpts
): Promise<{ quantity: number; known: boolean }> {
  const product = await fetchWixV1Product(accessToken, productId, opts);
  if (!product) return { quantity: 0, known: false };
  const axes = wixV1ProductToVariants(product);
  if (!axes || !hasOptionQuantities(axes)) return { quantity: 0, known: false };
  return { quantity: sumOptionQuantities(axes), known: true };
}

async function verifyWixQuantityApplied(
  accessToken: string,
  productId: string,
  want: number,
  opts: WixRequestOpts,
  v1Only: boolean,
  item?: SyncStoreItem
): Promise<{ ok: boolean; actual: number | null }> {
  const readQty = async (): Promise<{ quantity: number; known: boolean }> => {
    if (item && hasOptionQuantities(item.variants)) {
      return readWixPerOptionAggregateQuantity(accessToken, productId, opts);
    }
    return readWixProductQuantity(accessToken, productId, opts, v1Only);
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 900));
    const r = await readQty().catch(() => ({
      quantity: 0,
      known: false,
    }));
    if (!r.known) return { ok: true, actual: null };
    if (r.quantity === want) return { ok: true, actual: r.quantity };
    if (attempt === 1) return { ok: false, actual: r.quantity };
  }
  return { ok: true, actual: null };
}

async function setInventoryViaV3InventoryItems(
  accessToken: string,
  productId: string,
  quantity: number,
  opts: WixRequestOpts
): Promise<boolean> {
  const items = await searchInventoryItems(accessToken, [productId], opts);
  let updated = 0;
  for (const item of items) {
    if (!item.id || item.revision == null) continue;
    try {
      await wixJson(
        accessToken,
        `/stores/v3/inventory-items/${encodeURIComponent(item.id)}`,
        "PATCH",
        {
          // trackQuantity must be on or Wix keeps the item "in stock" and ignores the quantity.
          inventoryItem: { id: item.id, revision: item.revision, trackQuantity: true, quantity },
          reason: "MANUAL",
        },
        opts
      );
      updated += 1;
    } catch {
      /* try next item */
    }
  }
  return updated > 0;
}

async function setInventoryAbsolute(
  accessToken: string,
  productId: string,
  absoluteQuantity: number,
  opts: WixRequestOpts,
  v1Only: boolean
): Promise<string> {
  const quantity = Math.max(0, Math.round(absoluteQuantity));
  const strategies: Array<{ name: string; run: () => Promise<boolean> }> = v1Only
    ? [
        // Official Catalog v1 inventory API is Stores v2 updateInventoryVariants.
        { name: "v2/inventory", run: () => setInventoryViaStoresV2(accessToken, productId, quantity, opts) },
        { name: "v1/product", run: () => setInventoryViaStoresV1(accessToken, productId, quantity, opts) },
      ]
    : [
        {
          name: "v3/inventory-items",
          run: () => setInventoryViaV3InventoryItems(accessToken, productId, quantity, opts),
        },
        {
          name: "v3/product-patch",
          run: () => setInventoryViaProductPatchV3(accessToken, productId, quantity, opts),
        },
        { name: "v2/inventory", run: () => setInventoryViaStoresV2(accessToken, productId, quantity, opts) },
        { name: "v1/product", run: () => setInventoryViaStoresV1(accessToken, productId, quantity, opts) },
      ];

  let lastErr: unknown;
  const attemptErrors: string[] = [];
  for (const strategy of strategies) {
    try {
      if (await strategy.run()) {
        console.info("[wix] setInventoryAbsolute ok", {
          productId,
          strategy: strategy.name,
          quantity,
          v1Only,
        });
        return strategy.name;
      }
      attemptErrors.push(`${strategy.name}: no change`);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof WixApiError ? e.message : e instanceof Error ? e.message : String(e);
      attemptErrors.push(`${strategy.name}: ${msg}`);
      console.warn("[wix] setInventoryAbsolute failed", {
        productId,
        strategy: strategy.name,
        message: msg,
      });
    }
  }

  if (lastErr instanceof Error) throw lastErr;
  const detail = attemptErrors.length ? attemptErrors.join("; ") : "unknown error";
  throw new WixApiError(
    v1Only
      ? `Could not update inventory on Wix (Catalog v1): ${detail}`
      : `Could not update inventory on Wix: ${detail}`,
    502,
    null
  );
}

async function applyWixCategoryAndOptions(
  conn: ChannelConnectionContext,
  productId: string,
  item: SyncStoreItem,
  opts: WixRequestOpts,
  v1: boolean
): Promise<void> {
  const cat = await resolveProviderCategoryId(conn, "wix", item.category);
  const collectionName = cat.wixCollectionName ?? item.category;
  if (collectionName) {
    const collectionId = await ensureWixCollection(conn.accessToken, collectionName, opts, v1);
    if (collectionId) {
      await assignWixProductCollection(conn.accessToken, productId, collectionId, opts, v1);
    }
  }
  if (v1) {
    await pushWixV1OptionsUpdate(conn.accessToken, productId, item, opts);
    if (hasOptionQuantities(item.variants)) {
      await pushWixV1PerOptionInventory(conn.accessToken, productId, item, opts);
    }
  }
}

export const wixAdapter: ChannelAdapter = {
  provider: "wix",

  getAuthUrl: getWixAuthUrl,

  exchangeCode(): Promise<TokenResponse> {
    return exchangeWixCode();
  },

  refreshAccessToken(refreshToken): Promise<TokenResponse> {
    return refreshWixToken(refreshToken);
  },

  fetchShopInfo(accessToken) {
    return fetchWixShopInfo(accessToken);
  },

  async createListing(conn, item): Promise<CreateListingResult> {
    let mode = await prepareWixConn(conn);
    const opts = wixOpts(conn);

    const createV1 = async (): Promise<string | undefined> => {
      const res = await wixJson<{ product?: { id?: string } }>(
        conn.accessToken,
        `/stores/v1/products`,
        "POST",
        buildWixV1CreateBody(item),
        opts
      );
      return res.product?.id;
    };
    const createV3 = async (): Promise<string | undefined> => {
      const res = await wixJson<ProductResponse>(
        conn.accessToken,
        `/stores/v3/products-with-inventory`,
        "POST",
        buildWixCreateBody(item),
        opts
      );
      return res.product?.id;
    };

    // Retry once across catalog versions when the cached mode is wrong (428 wrong-catalog-version).
    for (let pass = 0; pass < 2; pass++) {
      try {
        const productId = mode === "v1" ? await createV1() : await createV3();
        if (!productId) {
          throw new Error("Wix did not return a product id for the created listing.");
        }
        await applyWixCategoryAndOptions(conn, productId, item, opts, mode === "v1");
        await syncWixProductMedia(conn, productId, item.photos);
        return { externalListingId: productId, externalShopId: conn.externalShopId };
      } catch (e) {
        const corrected = await refreshCatalogVersionAfterMismatch(conn, e);
        if (corrected && pass === 0) {
          mode = corrected;
          continue;
        }
        throw e;
      }
    }
    throw new WixApiError("Could not create listing on Wix.", 502, null);
  },

  async updateListing(conn, externalListingId, item): Promise<void> {
    let mode = await prepareWixConn(conn);
    const productId = externalListingId;
    const withSite = wixOpts(conn);
    const attempts: WixRequestOpts[] = withSite.siteId ? [withSite, {}] : [{}];
    let lastErr: unknown;

    for (let pass = 0; pass < 2; pass++) {
      for (const opts of attempts) {
        try {
          if (mode === "v1") {
            const v1Got = await wixGet<{ product?: WixV1Product }>(
              conn.accessToken,
              `/stores/v1/products/${encodeURIComponent(productId)}`,
              opts
            );
            await wixJson(
              conn.accessToken,
              `/stores/v1/products/${encodeURIComponent(productId)}`,
              "PATCH",
              buildWixV1UpdateBody(item, v1Got.product ?? null),
              opts
            );
            await applyWixCategoryAndOptions(conn, productId, item, opts, true);
            if (item.photos.length > 0) {
              await syncWixProductMedia(conn, productId, item.photos, { replace: true });
            }
            if (!hasOptionQuantities(item.variants)) {
              const strategy = await setInventoryAbsolute(
                conn.accessToken,
                productId,
                item.quantity,
                opts,
                true
              );
              console.info("[wix] updateListing ok", {
                productId,
                catalog: "v1",
                inventoryStrategy: strategy,
              });
            } else {
              console.info("[wix] updateListing ok", {
                productId,
                catalog: "v1",
                inventoryStrategy: "v1/options",
              });
            }
            return;
          }
          if (mode === "v3" || mode === "unknown") {
          const existing = await getProduct(conn.accessToken, productId, opts);
          if (existing?.revision) {
            const variantId = existing.variantsInfo?.variants?.[0]?.id ?? null;
            await wixJson(
              conn.accessToken,
              `/stores/v3/products/${encodeURIComponent(productId)}`,
              "PATCH",
              buildWixUpdateBody(item, existing.revision, variantId),
              opts
            );
            const strategy = await setInventoryAbsolute(
              conn.accessToken,
              productId,
              item.quantity,
              opts,
              false
            );
            if (item.photos.length > 0) {
              await syncWixProductMedia(conn, productId, item.photos, { replace: true }).catch(
                (e) => {
                  console.warn("[wix] updateListing v3 media sync failed", {
                    productId,
                    message: e instanceof Error ? e.message : String(e),
                  });
                }
              );
            }
            console.info("[wix] updateListing ok", { productId, catalog: "v3", inventoryStrategy: strategy });
            return;
          }
          if (mode === "v3") {
            throw new WixApiError("Product not found in Catalog v3.", 404, null);
          }
        }
        if (mode === "unknown") {
          const v1Probe = await wixGet<{ product?: WixV1Product }>(
            conn.accessToken,
            `/stores/v1/products/${encodeURIComponent(productId)}`,
            opts
          );
          await wixJson(
            conn.accessToken,
            `/stores/v1/products/${encodeURIComponent(productId)}`,
            "PATCH",
            buildWixV1UpdateBody(item, v1Probe.product ?? null),
            opts
          );
          const strategy = await setInventoryAbsolute(
            conn.accessToken,
            productId,
            item.quantity,
            opts,
            true
          );
          console.info("[wix] updateListing ok", { productId, catalog: "v1-probe", inventoryStrategy: strategy });
          return;
        }
        throw new WixApiError("Product not found on Wix.", 404, null);
        } catch (e) {
          lastErr = e;
          const corrected = await refreshCatalogVersionAfterMismatch(conn, e);
          if (corrected && pass === 0) {
            mode = corrected;
            break;
          }
        }
      }
      if (pass === 0 && mode !== "unknown") continue;
    }
    if (lastErr instanceof Error) throw lastErr;
    throw new WixApiError("Could not update listing on Wix.", 502, null);
  },

  async deleteListing(conn, externalListingId): Promise<void> {
    let mode = await prepareWixConn(conn);
    const withSite = wixOpts(conn);
    const attempts: WixRequestOpts[] = withSite.siteId ? [withSite, {}] : [{}];
    let lastErr: unknown;

    const pathsForMode = (m: WixCatalogMode) => {
      if (m === "v1") {
        return [{ catalog: "v1", path: `/stores/v1/products/${encodeURIComponent(externalListingId)}` }];
      }
      if (m === "v3") {
        return [{ catalog: "v3", path: `/stores/v3/products/${encodeURIComponent(externalListingId)}` }];
      }
      return [
        { catalog: "v3", path: `/stores/v3/products/${encodeURIComponent(externalListingId)}` },
        { catalog: "v1", path: `/stores/v1/products/${encodeURIComponent(externalListingId)}` },
      ];
    };

    for (let pass = 0; pass < 2; pass++) {
      for (const opts of attempts) {
        for (const { catalog, path } of pathsForMode(mode)) {
          try {
            await wixDelete(conn.accessToken, path, opts);
            console.info("[wix] deleteListing ok", {
              productId: externalListingId,
              catalog,
              mode,
            });
            return;
          } catch (e) {
            if (e instanceof WixApiError && e.status === 404) {
              lastErr = e;
              continue;
            }
            const corrected = await refreshCatalogVersionAfterMismatch(conn, e);
            if (corrected && pass === 0) {
              mode = corrected;
              break;
            }
            throw e;
          }
        }
      }
    }
    if (lastErr instanceof WixApiError && lastErr.status === 404) return;
    if (lastErr instanceof Error) throw lastErr;
  },

  async fetchProductQuantity(conn, externalListingId): Promise<{ quantity: number; known: boolean }> {
    const mode = await prepareWixConn(conn);
    const withSite = wixOpts(conn);
    const attempts: WixRequestOpts[] = withSite.siteId ? [withSite, {}] : [{}];
    for (const opts of attempts) {
      const r = await readWixProductQuantity(
        conn.accessToken,
        externalListingId,
        opts,
        mode === "v1"
      );
      if (r.known) return r;
    }
    return { quantity: 0, known: false };
  },

  async updateInventory(conn, externalListingId, absoluteQuantity, item): Promise<void> {
    let mode = await prepareWixConn(conn);
    const attempts = wixInventoryRequestOpts(conn);
    const want = assertSaneInventoryQty(
      Math.max(0, Math.round(absoluteQuantity)),
      "wix.updateInventory"
    );
    const verifyWant = hasOptionQuantities(item.variants)
      ? sumOptionQuantities(item.variants)
      : want;
    let lastErr: unknown;
    for (let pass = 0; pass < 2; pass++) {
      for (const opts of attempts) {
        try {
          if (mode === "v1" && hasOptionQuantities(item.variants)) {
            const pushed = await pushWixV1PerOptionInventory(
              conn.accessToken,
              externalListingId,
              item,
              opts
            );
            if (!pushed) {
              throw new WixApiError(
                "Could not update per-option inventory on Wix (Catalog v1). Check variant mapping in Sync Stores.",
                502,
                null
              );
            }
            const verified = await verifyWixQuantityApplied(
              conn.accessToken,
              externalListingId,
              verifyWant,
              opts,
              true,
              item
            );
            if (!verified.ok) {
              throw new WixApiError(
                `Wix per-option inventory still shows ${verified.actual ?? "unknown"} (expected sum ${verifyWant}).`,
                409,
                null
              );
            }
            console.info("[wix] updateInventory ok", {
              productId: externalListingId,
              strategy: "v1/options-v2",
              quantity: verifyWant,
            });
            return;
          }

          const strategy = await setInventoryAbsolute(
            conn.accessToken,
            externalListingId,
            want,
            opts,
            mode === "v1"
          );

          const verified = await verifyWixQuantityApplied(
            conn.accessToken,
            externalListingId,
            want,
            opts,
            mode === "v1",
            item
          );
          if (!verified.ok) {
            throw new WixApiError(
              `Wix accepted the inventory update (strategy ${strategy}) but stock is still ` +
                `${verified.actual ?? "unknown"} (expected ${want}). The product may not have ` +
                `inventory tracking enabled, or uses a different catalog/location.`,
              409,
              null
            );
          }

          console.info("[wix] updateInventory ok", {
            productId: externalListingId,
            strategy,
            mode,
            quantity: want,
          });
          return;
        } catch (e) {
          lastErr = e;
          if (isWixMetasiteContextError(e) && pass === 0) {
            const reminted = await remintWixAccessToken(conn);
            if (reminted) break;
          }
          const corrected = await refreshCatalogVersionAfterMismatch(conn, e);
          if (corrected && pass === 0) {
            mode = corrected;
            break;
          }
        }
      }
    }
    if (lastErr instanceof Error) throw lastErr;
    throw new WixApiError("Could not update inventory on Wix.", 502, null);
  },

  async listRemoteListings(conn): Promise<RemoteListingSummary[]> {
    const mode = await prepareWixConn(conn);
    const siteId = wixSiteIdFromConn(conn);
    const token = conn.accessToken;
    const withSite = siteId ? { siteId } : {};
    const noSite: WixRequestOpts = {};

    const v1Strategies: Array<{ name: string; run: () => Promise<RemoteListingSummary[]> }> = [
      {
        name: "v1/stores",
        run: () => queryAllProductsV1(token, "/stores/v1/products/query", noSite),
      },
      {
        name: "v1/reader",
        run: () => queryAllProductsV1(token, "/stores-reader/v1/products/query", noSite),
      },
      ...(siteId
        ? [
            {
              name: "v1/stores+siteId",
              run: () => queryAllProductsV1(token, "/stores/v1/products/query", withSite),
            },
          ]
        : []),
    ];

    const v3Strategies: Array<{ name: string; run: () => Promise<RemoteListingSummary[]> }> = [
      { name: "v3", run: () => listRemoteListingsV3(token, noSite) },
      ...(siteId ? [{ name: "v3+siteId", run: () => listRemoteListingsV3(token, withSite) }] : []),
    ];

    const strategies =
      mode === "v1"
        ? v1Strategies
        : [...v3Strategies, ...v1Strategies];

    let lastError: unknown;
    for (const strategy of strategies) {
      try {
        const listings = await strategy.run();
        console.info("[wix] listRemoteListings", { strategy: strategy.name, count: listings.length });
        // Classic Editor sites often return HTTP 200 with zero v3 products — keep trying v1.
        if (listings.length > 0) {
          const catalogApi = catalogApiFromListStrategy(strategy.name);
          if (catalogApi) {
            await persistWixCatalogApi(conn.id, catalogApi, strategy.name);
            if (conn.config) conn.config.catalogApi = catalogApi;
          }
          return listings;
        }
      } catch (e) {
        lastError = e;
        const status = e instanceof WixApiError ? e.status : undefined;
        console.warn("[wix] listRemoteListings failed", {
          strategy: strategy.name,
          status,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (lastError instanceof WixApiError) throw lastError;
    if (lastError instanceof Error) throw lastError;
    return [];
  },

  async fetchRecentSales(conn, since): Promise<RemoteSale[]> {
    await ensureWixSiteId(conn);
    const opts = wixOpts(conn);
    const sinceIso = since.toISOString();
    const sales: RemoteSale[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 20; page++) {
      const res = await wixJson<{
        orders?: {
          id?: string;
          lineItems?: {
            id?: string;
            quantity?: number;
            catalogReference?: { catalogItemId?: string };
            physicalProperties?: { sku?: string };
          }[];
        }[];
        metadata?: { cursors?: { next?: string | null } };
      }>(
        conn.accessToken,
        `/ecom/v1/orders/search`,
        "POST",
        {
          search: {
            filter: { createdDate: { $gte: sinceIso } },
            cursorPaging: { limit: 100, ...(cursor ? { cursor } : {}) },
          },
        },
        opts
      ).catch(() => null);

      const orders = res?.orders ?? [];
      for (const order of orders) {
        if (!order.id) continue;
        for (const li of order.lineItems ?? []) {
          const productId = li.catalogReference?.catalogItemId;
          if (!productId || !li.id) continue;
          sales.push({
            externalEventId: `order:${order.id}:line:${li.id}`,
            externalListingId: productId,
            quantitySold: Math.max(1, li.quantity ?? 1),
            sku: li.physicalProperties?.sku ?? null,
          });
        }
      }

      const next = res?.metadata?.cursors?.next;
      if (!next || orders.length === 0) break;
      cursor = next;
    }

    return sales;
  },
};
