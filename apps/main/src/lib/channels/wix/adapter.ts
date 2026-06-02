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
import { ensureWixSiteId, wixSiteIdFromConn } from "./site";
import {
  buildWixCreateBody,
  buildWixUpdateBody,
  buildWixV1UpdateBody,
  isWixProductVisibleOnSite,
  v1Quantity,
  wixProductToSummary,
  wixV1ProductToSummary,
  type WixProduct,
  type WixV1Product,
} from "./mapping";

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
      `/stores/v3/products/${encodeURIComponent(productId)}?fields=MEDIA_ITEMS_INFO`,
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

/** Catalog v3 — used on newer Stores catalogs. */
async function queryAllProductsV3(accessToken: string, opts: WixRequestOpts): Promise<WixProduct[]> {
  const products: WixProduct[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await wixJson<ProductsQueryResponse>(
      accessToken,
      `/stores/v3/products/query`,
      "POST",
      {
        fields: ["MEDIA_ITEMS_INFO", "CURRENCY"],
        query: {
          cursorPaging: { limit: 100, ...(cursor ? { cursor } : {}) },
        },
      },
      opts
    );
    const batch = (res.products ?? []).filter((p) => p.id);
    products.push(...batch);
    const next = res.pagingMetadata?.cursors?.next;
    if (!next || batch.length === 0) break;
    cursor = next;
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
  for (let page = 0; page < 50; page++) {
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
    const batch = (res.products ?? []).filter((p) => p.id && isWixProductVisibleOnSite(p));
    for (const p of batch) {
      const s = wixV1ProductToSummary(p);
      if (s.externalListingId) summaries.push(s);
    }
    if (batch.length < 100) break;
    offset += batch.length;
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
    const variant: Record<string, unknown> = { inventoryItem: { quantity } };
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

/** Classic Wix Stores — Catalog v1 + Inventory v2 (common on Editor sites). */
async function setInventoryViaStoresV2(
  accessToken: string,
  productId: string,
  quantity: number,
  opts: WixRequestOpts
): Promise<boolean> {
  const qty = Math.max(0, Math.round(quantity));
  try {
    let variantId: string | undefined;
    try {
      const inv = await wixGet<{
        inventoryItem?: { variants?: { variantId?: string }[] };
      }>(
        accessToken,
        `/stores/v2/inventoryItems/product/${encodeURIComponent(productId)}`,
        opts
      );
      variantId = inv.inventoryItem?.variants?.[0]?.variantId;
    } catch {
      /* variant id optional */
    }
    await wixJson(
      accessToken,
      `/stores/v2/inventoryItems/product/${encodeURIComponent(productId)}`,
      "PATCH",
      {
        inventoryItem: {
          productId,
          trackQuantity: true,
          variants: [
            {
              ...(variantId ? { variantId } : {}),
              quantity: qty,
              inStock: qty > 0,
            },
          ],
        },
      },
      opts
    );
    return true;
  } catch {
    return false;
  }
}

/** Catalog v1 product PATCH when v3 inventory APIs are unavailable. */
async function setInventoryViaStoresV1(
  accessToken: string,
  productId: string,
  quantity: number,
  opts: WixRequestOpts
): Promise<boolean> {
  const qty = Math.max(0, Math.round(quantity));
  const stock = { trackQuantity: true, quantity: qty, inStock: qty > 0 };
  try {
    const got = await wixGet<{ product?: WixV1Product }>(
      accessToken,
      `/stores/v1/products/${encodeURIComponent(productId)}`,
      opts
    );
    const variantId = got.product?.variants?.[0]?.id;
    if (variantId) {
      await wixJson(
        accessToken,
        `/stores/v1/products/${encodeURIComponent(productId)}`,
        "PATCH",
        { product: { variants: [{ id: variantId, stock }] } },
        opts
      );
    } else {
      await wixJson(
        accessToken,
        `/stores/v1/products/${encodeURIComponent(productId)}`,
        "PATCH",
        { product: { stock: { trackInventory: true, quantity: qty, inStock: qty > 0 } } },
        opts
      );
    }
    return true;
  } catch {
    return false;
  }
}

/** Read absolute stock for one product (classic v2/v1 first, then v3 inventory search). */
export async function readWixProductQuantity(
  accessToken: string,
  productId: string,
  opts: WixRequestOpts
): Promise<{ quantity: number; known: boolean }> {
  try {
    const inv = await wixGet<{
      inventoryItem?: { variants?: { quantity?: number; inStock?: boolean }[] };
    }>(accessToken, `/stores/v2/inventoryItems/product/${encodeURIComponent(productId)}`, opts);
    const variants = inv.inventoryItem?.variants ?? [];
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
  } catch {
    /* try v1 */
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
    /* try v3 */
  }

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

async function setInventoryAbsolute(
  accessToken: string,
  productId: string,
  absoluteQuantity: number,
  opts: WixRequestOpts
): Promise<void> {
  const quantity = Math.max(0, Math.round(absoluteQuantity));
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
          inventoryItem: { id: item.id, revision: item.revision, quantity },
          reason: "MANUAL",
        },
        opts
      );
      updated += 1;
    } catch {
      /* try other strategies */
    }
  }
  if (updated > 0) return;

  if (await setInventoryViaProductPatchV3(accessToken, productId, quantity, opts)) return;
  if (await setInventoryViaStoresV2(accessToken, productId, quantity, opts)) return;
  if (await setInventoryViaStoresV1(accessToken, productId, quantity, opts)) return;

  throw new WixApiError(
    "Could not update inventory on Wix (tried Catalog v3, Stores v2, and v1).",
    502,
    null
  );
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
    const opts = wixOpts(conn);
    const res = await wixJson<ProductResponse>(
      conn.accessToken,
      `/stores/v3/products-with-inventory`,
      "POST",
      buildWixCreateBody(item),
      opts
    );
    const productId = res.product?.id;
    if (!productId) {
      throw new Error("Wix did not return a product id for the created listing.");
    }
    return { externalListingId: productId, externalShopId: conn.externalShopId };
  },

  async updateListing(conn, externalListingId, item): Promise<void> {
    await ensureWixSiteId(conn);
    const productId = externalListingId;
    const withSite = wixOpts(conn);
    const attempts: WixRequestOpts[] = withSite.siteId ? [withSite, {}] : [{}];
    let lastErr: unknown;

    for (const opts of attempts) {
      try {
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
          await setInventoryAbsolute(conn.accessToken, productId, item.quantity, opts);
          return;
        }
        await wixJson(
          conn.accessToken,
          `/stores/v1/products/${encodeURIComponent(productId)}`,
          "PATCH",
          buildWixV1UpdateBody(item),
          opts
        );
        await setInventoryAbsolute(conn.accessToken, productId, item.quantity, opts);
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr instanceof Error) throw lastErr;
    throw new WixApiError("Could not update listing on Wix.", 502, null);
  },

  async deleteListing(conn, externalListingId): Promise<void> {
    await ensureWixSiteId(conn);
    const withSite = wixOpts(conn);
    const attempts: WixRequestOpts[] = withSite.siteId ? [withSite, {}] : [{}];
    let lastErr: unknown;
    for (const opts of attempts) {
      try {
        await wixDelete(
          conn.accessToken,
          `/stores/v3/products/${encodeURIComponent(externalListingId)}`,
          opts
        );
        return;
      } catch (e) {
        if (e instanceof WixApiError && e.status === 404) {
          lastErr = e;
          continue;
        }
        throw e;
      }
    }
    for (const opts of attempts) {
      try {
        await wixDelete(
          conn.accessToken,
          `/stores/v1/products/${encodeURIComponent(externalListingId)}`,
          opts
        );
        return;
      } catch (e) {
        lastErr = e;
        if (!(e instanceof WixApiError && e.status === 404)) throw e;
      }
    }
    if (lastErr instanceof WixApiError && lastErr.status === 404) return;
    if (lastErr instanceof Error) throw lastErr;
  },

  async fetchProductQuantity(conn, externalListingId): Promise<{ quantity: number; known: boolean }> {
    await ensureWixSiteId(conn);
    const withSite = wixOpts(conn);
    const attempts: WixRequestOpts[] = withSite.siteId ? [withSite, {}] : [{}];
    for (const opts of attempts) {
      const r = await readWixProductQuantity(conn.accessToken, externalListingId, opts);
      if (r.known) return r;
    }
    return { quantity: 0, known: false };
  },

  async updateInventory(conn, externalListingId, absoluteQuantity): Promise<void> {
    await ensureWixSiteId(conn);
    const withSite = wixOpts(conn);
    const attempts: WixRequestOpts[] = withSite.siteId ? [withSite, {}] : [{}];
    let lastErr: unknown;
    for (const opts of attempts) {
      try {
        await setInventoryAbsolute(conn.accessToken, externalListingId, absoluteQuantity, opts);
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr instanceof Error) throw lastErr;
    throw new WixApiError("Could not update inventory on Wix.", 502, null);
  },

  async listRemoteListings(conn): Promise<RemoteListingSummary[]> {
    await ensureWixSiteId(conn);
    const siteId = wixSiteIdFromConn(conn);
    const token = conn.accessToken;
    const withSite = siteId ? { siteId } : {};
    const noSite: WixRequestOpts = {};

    const strategies: Array<{ name: string; run: () => Promise<RemoteListingSummary[]> }> = [
      { name: "v3", run: () => listRemoteListingsV3(token, noSite) },
      ...(siteId ? [{ name: "v3+siteId", run: () => listRemoteListingsV3(token, withSite) }] : []),
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

    let lastError: unknown;
    for (const strategy of strategies) {
      try {
        const listings = await strategy.run();
        console.info("[wix] listRemoteListings", { strategy: strategy.name, count: listings.length });
        // Classic Editor sites often return HTTP 200 with zero v3 products — keep trying v1.
        if (listings.length > 0) return listings;
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
