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
  buildWixCreateBody,
  buildWixUpdateBody,
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

function siteIdFromConn(conn: ChannelConnectionContext): string | null {
  const fromConfig = conn.config?.siteId;
  if (typeof fromConfig === "string" && fromConfig.trim()) return fromConfig.trim();
  const shop = conn.externalShopId?.trim();
  return shop || null;
}

function wixOpts(conn: ChannelConnectionContext): WixRequestOpts {
  return { siteId: siteIdFromConn(conn) };
}

/** Optional Stores location to scope inventory reads/writes (defaults to the site default). */
function defaultLocationId(): string | null {
  try {
    return getWixConfig().defaultLocationId;
  } catch {
    return null;
  }
}

function shouldFallbackToV1Catalog(e: unknown): boolean {
  if (!(e instanceof WixApiError)) return false;
  if (e.status === 404 || e.status === 403 || e.status === 501) return true;
  if (e.status === 400) {
    const msg = e.message.toLowerCase();
    return (
      msg.includes("catalog") ||
      msg.includes("not found") ||
      msg.includes("v3") ||
      msg.includes("unsupported")
    );
  }
  return false;
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

/** Catalog v1 (stores-reader) — classic Wix Editor + Wix Stores sites. */
async function queryAllProductsV1(
  accessToken: string,
  opts: WixRequestOpts
): Promise<RemoteListingSummary[]> {
  const summaries: RemoteListingSummary[] = [];
  let offset = 0;
  for (let page = 0; page < 50; page++) {
    const res = await wixJson<V1ProductsQueryResponse>(
      accessToken,
      `/stores-reader/v1/products/query`,
      "POST",
      {
        includeVariants: true,
        query: { paging: { limit: 100, offset } },
      },
      opts
    );
    const batch = (res.products ?? []).filter((p) => p.id);
    for (const p of batch) {
      const s = wixV1ProductToSummary(p);
      if (s.externalListingId) summaries.push(s);
    }
    if (batch.length < 100) break;
    offset += batch.length;
  }
  return summaries;
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

async function setInventoryAbsolute(
  accessToken: string,
  productId: string,
  absoluteQuantity: number,
  opts: WixRequestOpts
): Promise<void> {
  const quantity = Math.max(0, Math.round(absoluteQuantity));
  const items = await searchInventoryItems(accessToken, [productId], opts);
  for (const item of items) {
    if (!item.id || item.revision == null) continue;
    await wixJson(
      accessToken,
      `/stores/v3/inventory-items/${encodeURIComponent(item.id)}`,
      "PATCH",
      {
        inventoryItem: { id: item.id, revision: item.revision, quantity },
        reason: "MANUAL",
      },
      opts
    ).catch((e) => {
      console.error("[wix] inventory update failed", { productId, itemId: item.id, error: String(e) });
    });
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
    const opts = wixOpts(conn);
    const productId = externalListingId;
    const existing = await getProduct(conn.accessToken, productId, opts);
    if (!existing?.revision) {
      return;
    }
    const variantId = existing.variantsInfo?.variants?.[0]?.id ?? null;
    await wixJson(
      conn.accessToken,
      `/stores/v3/products/${encodeURIComponent(productId)}`,
      "PATCH",
      buildWixUpdateBody(item, existing.revision, variantId),
      opts
    );
    await setInventoryAbsolute(conn.accessToken, productId, item.quantity, opts);
  },

  async deleteListing(conn, externalListingId): Promise<void> {
    const opts = wixOpts(conn);
    try {
      await wixDelete(conn.accessToken, `/stores/v3/products/${encodeURIComponent(externalListingId)}`, opts);
    } catch (e) {
      if (!(e instanceof WixApiError && e.status === 404)) throw e;
    }
  },

  async updateInventory(conn, externalListingId, absoluteQuantity): Promise<void> {
    await setInventoryAbsolute(conn.accessToken, externalListingId, absoluteQuantity, wixOpts(conn));
  },

  async listRemoteListings(conn): Promise<RemoteListingSummary[]> {
    const opts = wixOpts(conn);

    try {
      const products = await queryAllProductsV3(conn.accessToken, opts);

      const byProduct = new Map<string, InventoryItem[]>();
      const items = await searchInventoryItems(
        conn.accessToken,
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
          return invItems ? { ...summary, quantity: quantityForProduct(invItems) } : summary;
        })
        .filter((s) => s.externalListingId);
    } catch (e) {
      if (!shouldFallbackToV1Catalog(e)) throw e;
      console.warn("[wix] catalog v3 unavailable, falling back to v1", {
        status: e instanceof WixApiError ? e.status : undefined,
        message: e instanceof Error ? e.message : String(e),
      });
      return queryAllProductsV1(conn.accessToken, opts);
    }
  },

  async fetchRecentSales(conn, since): Promise<RemoteSale[]> {
    const opts = wixOpts(conn);
    const sinceIso = since.toISOString();
    const res = await wixJson<{
      orders?: {
        id?: string;
        number?: string;
        lineItems?: {
          id?: string;
          quantity?: number;
          catalogReference?: { catalogItemId?: string };
          physicalProperties?: { sku?: string };
        }[];
      }[];
    }>(conn.accessToken, `/ecom/v1/orders/search`, "POST", {
      filter: { createdDate: { $gte: sinceIso } },
      cursorPaging: { limit: 100 },
    }, opts).catch(() => null);

    const sales: RemoteSale[] = [];
    for (const order of res?.orders ?? []) {
      for (const li of order.lineItems ?? []) {
        const productId = li.catalogReference?.catalogItemId;
        if (!productId) continue;
        sales.push({
          externalEventId: `order:${order.id}:line:${li.id}`,
          externalListingId: productId,
          quantitySold: Math.max(1, li.quantity ?? 1),
          sku: li.physicalProperties?.sku ?? null,
        });
      }
    }
    return sales;
  },
};
