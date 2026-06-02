import type {
  ChannelAdapter,
  ChannelConnectionContext,
  CreateListingResult,
  RemoteListingSummary,
  RemoteSale,
  SyncStoreItem,
  TokenResponse,
} from "../types";
import { WixApiError, wixDelete, wixGet, wixJson } from "./client";
import { getWixConfig } from "./config";
import { exchangeWixCode, fetchWixShopInfo, getWixAuthUrl, refreshWixToken } from "./oauth";
import {
  buildWixCreateBody,
  buildWixUpdateBody,
  wixProductToSummary,
  type WixProduct,
} from "./mapping";

type ProductResponse = { product?: WixProduct };
type ProductsQueryResponse = {
  products?: WixProduct[];
  pagingMetadata?: { cursors?: { next?: string | null } };
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

/** Optional Stores location to scope inventory reads/writes (defaults to the site default). */
function defaultLocationId(): string | null {
  try {
    return getWixConfig().defaultLocationId;
  } catch {
    return null;
  }
}

/** Fetch a product (revision + variant id are required for updates). */
async function getProduct(accessToken: string, productId: string): Promise<WixProduct | null> {
  try {
    const res = await wixGet<ProductResponse>(
      accessToken,
      `/stores/v3/products/${encodeURIComponent(productId)}?fields=MEDIA_ITEMS_INFO`
    );
    return res.product ?? null;
  } catch (e) {
    if (e instanceof WixApiError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Resolve the inventory items for one or more products so we can read/set absolute quantities.
 * When WIX_DEFAULT_LOCATION_ID is set, results are scoped to that location so multi-location sites
 * don't get every location set to the same absolute quantity.
 */
async function searchInventoryItems(
  accessToken: string,
  productIds: string[]
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
    }
  ).catch(() => null);
  return res?.inventoryItems ?? [];
}

/** List catalog products via Query Products (Search requires search.fields; Query lists all). */
async function queryAllProducts(accessToken: string): Promise<WixProduct[]> {
  const products: WixProduct[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await wixJson<ProductsQueryResponse>(
      accessToken,
      `/stores/v3/products/query`,
      "POST",
      {
        fields: ["MEDIA_ITEMS_INFO"],
        query: {
          cursorPaging: { limit: 100, ...(cursor ? { cursor } : {}) },
        },
      }
    );
    const batch = (res.products ?? []).filter((p) => p.id);
    products.push(...batch);
    const next = res.pagingMetadata?.cursors?.next;
    if (!next || batch.length === 0) break;
    cursor = next;
  }
  return products;
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
  absoluteQuantity: number
): Promise<void> {
  const quantity = Math.max(0, Math.round(absoluteQuantity));
  const items = await searchInventoryItems(accessToken, [productId]);
  for (const item of items) {
    if (!item.id || item.revision == null) continue;
    await wixJson(accessToken, `/stores/v3/inventory-items/${encodeURIComponent(item.id)}`, "PATCH", {
      inventoryItem: { id: item.id, revision: item.revision, quantity },
      reason: "MANUAL",
    }).catch((e) => {
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
    // For Wix the "refresh token" is the site's instanceId; this re-mints a 4h token.
    return refreshWixToken(refreshToken);
  },

  fetchShopInfo(accessToken) {
    return fetchWixShopInfo(accessToken);
  },

  async createListing(conn, item): Promise<CreateListingResult> {
    const res = await wixJson<ProductResponse>(
      conn.accessToken,
      `/stores/v3/products-with-inventory`,
      "POST",
      buildWixCreateBody(item)
    );
    const productId = res.product?.id;
    if (!productId) {
      throw new Error("Wix did not return a product id for the created listing.");
    }
    return { externalListingId: productId, externalShopId: conn.externalShopId };
  },

  async updateListing(conn, externalListingId, item): Promise<void> {
    const productId = externalListingId;
    const existing = await getProduct(conn.accessToken, productId);
    if (!existing?.revision) {
      // Product is gone on Wix; nothing to update (outbound will recreate if needed elsewhere).
      return;
    }
    const variantId = existing.variantsInfo?.variants?.[0]?.id ?? null;
    await wixJson(
      conn.accessToken,
      `/stores/v3/products/${encodeURIComponent(productId)}`,
      "PATCH",
      buildWixUpdateBody(item, existing.revision, variantId)
    );
    await setInventoryAbsolute(conn.accessToken, productId, item.quantity);
  },

  async deleteListing(conn, externalListingId): Promise<void> {
    try {
      await wixDelete(conn.accessToken, `/stores/v3/products/${encodeURIComponent(externalListingId)}`);
    } catch (e) {
      if (!(e instanceof WixApiError && e.status === 404)) throw e;
    }
  },

  async updateInventory(conn, externalListingId, absoluteQuantity): Promise<void> {
    await setInventoryAbsolute(conn.accessToken, externalListingId, absoluteQuantity);
  },

  async listRemoteListings(conn): Promise<RemoteListingSummary[]> {
    const products = await queryAllProducts(conn.accessToken);

    // Query Products doesn't return per-variant inventory, so fetch the real quantities in a
    // single bulk inventory search. This keeps the imported StoreItem's base stock accurate instead
    // of a placeholder (which would otherwise get pushed back and overwrite the real Wix quantity).
    const byProduct = new Map<string, InventoryItem[]>();
    const items = await searchInventoryItems(
      conn.accessToken,
      products.map((p) => p.id as string)
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
  },

  async fetchRecentSales(conn, since): Promise<RemoteSale[]> {
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
    }).catch(() => null);

    const sales: RemoteSale[] = [];
    for (const order of res?.orders ?? []) {
      for (const li of order.lineItems ?? []) {
        const productId = li.catalogReference?.catalogItemId;
        if (!productId) continue; // skip custom (non-catalog) line items
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
