import type {
  ChannelAdapter,
  ChannelConnectionContext,
  CreateListingResult,
  RemoteListingSummary,
  RemoteSale,
  SyncStoreItem,
  TokenResponse,
} from "../types";
import {
  ShopifyApiError,
  shopifyDelete,
  shopifyGet,
  shopifyGetWithPagination,
  shopifyJson,
  type ShopifyGetResult,
} from "./client";
import { getShopifyConfig, readShopifyConfig } from "./config";
import {
  exchangeShopifyCode,
  fetchShopifyShopInfo,
  getShopifyAuthUrl,
  refreshShopifyToken,
} from "./oauth";
import {
  buildShopifyCreateBody,
  buildShopifyUpdateBody,
  shopifyProductToSummary,
  type ShopifyProduct,
} from "./mapping";
import { normalizeVariantsFromProvider } from "../variant-sync";
import { hasOptionQuantities } from "../../store-item-variants";

type ProductsResponse = { products?: ShopifyProduct[] };
type ProductResponse = { product?: ShopifyProduct };

function connCfg(conn: ChannelConnectionContext) {
  return readShopifyConfig(conn.config, conn.externalShopId);
}

async function getProduct(
  accessToken: string,
  shop: string,
  apiVersion: string,
  productId: string
): Promise<ShopifyProduct | null> {
  try {
    const res = await shopifyGet<ProductResponse>(
      accessToken,
      shop,
      apiVersion,
      `/products/${productId}.json`
    );
    return res.product ?? null;
  } catch (e) {
    if (e instanceof ShopifyApiError && e.status === 404) return null;
    throw e;
  }
}

async function setInventoryAbsolute(
  accessToken: string,
  shop: string,
  apiVersion: string,
  locationId: string,
  inventoryItemId: number,
  absoluteQuantity: number
): Promise<void> {
  await shopifyJson(
    accessToken,
    shop,
    apiVersion,
    "/inventory_levels/set.json",
    "POST",
    {
      location_id: Number(locationId),
      inventory_item_id: inventoryItemId,
      available: Math.max(0, Math.round(absoluteQuantity)),
    }
  );
}

/** True when the order should decrement pooled inventory (paid, not cancelled/voided/refunded). */
function isShopifySaleOrder(order: {
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  financial_status?: string | null;
}): boolean {
  if (order.cancelled_at || order.cancel_reason) return false;
  const fs = (order.financial_status || "").toLowerCase();
  if (fs === "voided" || fs === "refunded") return false;
  return fs === "paid" || fs === "partially_paid" || fs === "authorized";
}

async function syncProductInventory(
  conn: ChannelConnectionContext,
  productId: string,
  absoluteQuantity: number,
  opts?: { strict?: boolean }
): Promise<void> {
  const cfg = connCfg(conn);
  if (!cfg.shop) {
    if (opts?.strict) throw new Error("Shopify connection is missing shop domain.");
    return;
  }
  if (!cfg.locationId) {
    if (opts?.strict) {
      throw new Error(
        "Shopify inventory location is not configured. Reconnect or set SHOPIFY_DEFAULT_LOCATION_ID."
      );
    }
    return;
  }
  const product = await getProduct(conn.accessToken, cfg.shop, cfg.apiVersion, productId);
  const variant = product?.variants?.[0];
  const inventoryItemId = variant?.inventory_item_id;
  if (!inventoryItemId) {
    if (opts?.strict) {
      throw new Error("Shopify product has no inventory item; enable inventory tracking on the variant.");
    }
    return;
  }
  await setInventoryAbsolute(
    conn.accessToken,
    cfg.shop,
    cfg.apiVersion,
    cfg.locationId,
    inventoryItemId,
    absoluteQuantity
  );
}

async function syncShopifyVariantInventory(
  conn: ChannelConnectionContext,
  productId: string,
  item: SyncStoreItem
): Promise<void> {
  const cfg = connCfg(conn);
  if (!cfg.shop) throw new Error("Shopify connection is missing shop domain.");
  if (!cfg.locationId) {
    throw new Error(
      "Shopify inventory location is not configured. Reconnect or set SHOPIFY_DEFAULT_LOCATION_ID."
    );
  }
  const existing = await getProduct(conn.accessToken, cfg.shop, cfg.apiVersion, productId);
  if (!existing?.variants?.length) {
    await syncProductInventory(conn, productId, item.quantity, { strict: true });
    return;
  }
  const axes = normalizeVariantsFromProvider("shopify", item.variants);
  for (const v of existing.variants) {
    if (v.inventory_item_id == null) continue;
    let qty = item.quantity;
    if (axes && axes.length > 0 && v.option1) {
      for (const axis of axes) {
        const match = axis.options.find(
          (o) =>
            o.value === v.option1 || o.value === v.option2 || o.value === v.option3
        );
        if (match) {
          qty = match.quantity;
          break;
        }
      }
    }
    await setInventoryAbsolute(
      conn.accessToken,
      cfg.shop,
      cfg.apiVersion,
      cfg.locationId,
      v.inventory_item_id,
      qty
    );
  }
}

export const shopifyAdapter: ChannelAdapter = {
  provider: "shopify",

  getAuthUrl(args) {
    if (!args.shop) throw new Error("Shopify shop domain is required.");
    return getShopifyAuthUrl({
      shop: args.shop,
      state: args.state,
      codeChallenge: args.codeChallenge,
      redirectUri: args.redirectUri,
    });
  },

  exchangeCode(args): Promise<TokenResponse> {
    if (!args.shop) throw new Error("Shopify shop domain is required.");
    return exchangeShopifyCode(args);
  },

  refreshAccessToken(): Promise<TokenResponse> {
    return refreshShopifyToken();
  },

  fetchShopInfo(accessToken, options) {
    const shop = options?.shop;
    if (!shop) throw new Error("Shopify shop domain is required.");
    return fetchShopifyShopInfo(accessToken, shop);
  },

  async getInitialConfig(accessToken, shopId): Promise<Record<string, unknown>> {
    const shop = shopId;
    const { apiVersion, defaultLocationId } = getShopifyConfig();
    let locationId = defaultLocationId;
    if (!locationId) {
      const res = await shopifyGet<{ locations?: { id?: number; active?: boolean }[] }>(
        accessToken,
        shop,
        apiVersion,
        "/locations.json"
      ).catch(() => null);
      const loc = (res?.locations ?? []).find((l) => l.active !== false) ?? res?.locations?.[0];
      if (loc?.id != null) locationId = String(loc.id);
    }
    return { shop, locationId, apiVersion };
  },

  async createListing(conn, item): Promise<CreateListingResult> {
    const cfg = connCfg(conn);
    if (!cfg.shop) throw new Error("Shopify connection is missing shop domain.");
    const res = await shopifyJson<ProductResponse>(
      conn.accessToken,
      cfg.shop,
      cfg.apiVersion,
      "/products.json",
      "POST",
      buildShopifyCreateBody(item)
    );
    const productId = res.product?.id;
    if (productId == null) {
      throw new Error("Shopify did not return a product id for the created listing.");
    }
    const pid = String(productId);
    if (cfg.locationId) {
      const product = res.product;
      const variants = product?.variants ?? [];
      if (variants.length > 1) {
        const axes = normalizeVariantsFromProvider("shopify", item.variants);
        for (const v of variants) {
          if (v.inventory_item_id == null) continue;
          let qty = item.quantity;
          if (axes && axes.length > 0) {
            const match = axes.flatMap((a) => a.options).find((o) => o.value === v.option1 || o.value === v.option2 || o.value === v.option3);
            if (match) qty = match.quantity;
          }
          await setInventoryAbsolute(
            conn.accessToken,
            cfg.shop,
            cfg.apiVersion,
            cfg.locationId,
            v.inventory_item_id,
            qty
          ).catch(() => {});
        }
      } else {
        await syncProductInventory(conn, pid, item.quantity).catch((e) => {
          console.error("[shopify] post-create inventory sync failed", { productId: pid, error: String(e) });
        });
      }
    }
    return { externalListingId: pid, externalShopId: cfg.shop };
  },

  async updateListing(conn, externalListingId, item): Promise<void> {
    const cfg = connCfg(conn);
    if (!cfg.shop) return;
    const existing = await getProduct(conn.accessToken, cfg.shop, cfg.apiVersion, externalListingId);
    if (!existing) return;
    await shopifyJson(
      conn.accessToken,
      cfg.shop,
      cfg.apiVersion,
      `/products/${externalListingId}.json`,
      "PUT",
      buildShopifyUpdateBody(item, externalListingId, existing)
    );
    if (hasOptionQuantities(item.variants)) {
      await syncShopifyVariantInventory(conn, externalListingId, item);
    } else {
      await syncProductInventory(conn, externalListingId, item.quantity);
    }
  },

  async deleteListing(conn, externalListingId): Promise<void> {
    const cfg = connCfg(conn);
    if (!cfg.shop) return;
    try {
      await shopifyDelete(
        conn.accessToken,
        cfg.shop,
        cfg.apiVersion,
        `/products/${externalListingId}.json`
      );
    } catch (e) {
      if (!(e instanceof ShopifyApiError && e.status === 404)) throw e;
    }
  },

  async updateInventory(conn, externalListingId, absoluteQuantity, item): Promise<void> {
    if (hasOptionQuantities(item.variants)) {
      await syncShopifyVariantInventory(conn, externalListingId, item);
      return;
    }
    await syncProductInventory(conn, externalListingId, absoluteQuantity, { strict: true });
  },

  async listRemoteListings(conn): Promise<RemoteListingSummary[]> {
    const cfg = connCfg(conn);
    if (!cfg.shop) return [];
    const summaries: RemoteListingSummary[] = [];
    let path: string | null = "/products.json?limit=250";
    for (let page = 0; page < 20 && path; page += 1) {
      const currentPath = path;
      const pageRes: ShopifyGetResult<ProductsResponse> = await shopifyGetWithPagination(
        conn.accessToken,
        cfg.shop,
        cfg.apiVersion,
        currentPath
      );
      for (const p of pageRes.data.products ?? []) {
        const s = shopifyProductToSummary(p);
        if (s.externalListingId) summaries.push(s);
      }
      path = pageRes.nextUrl;
    }
    return summaries;
  },

  async fetchRecentSales(conn, since): Promise<RemoteSale[]> {
    const cfg = connCfg(conn);
    if (!cfg.shop) return [];
    const sinceIso = since.toISOString();
    const sales: RemoteSale[] = [];
    type OrdersPage = {
      orders?: {
        id?: number;
        cancelled_at?: string | null;
        cancel_reason?: string | null;
        financial_status?: string | null;
        line_items?: {
          id?: number;
          product_id?: number | null;
          sku?: string | null;
          quantity?: number;
          variant_title?: string | null;
          properties?: { name?: string; value?: string }[];
        }[];
      }[];
    };
    let ordersPath: string | null =
      `/orders.json?status=any&created_at_min=${encodeURIComponent(sinceIso)}&limit=250`;
    for (let page = 0; page < 10 && ordersPath; page += 1) {
      let pageRes: { data: OrdersPage; nextUrl: string | null };
      try {
        pageRes = await shopifyGetWithPagination<OrdersPage>(
          conn.accessToken,
          cfg.shop,
          cfg.apiVersion,
          ordersPath
        );
      } catch {
        break;
      }
      const res = pageRes.data;

      for (const order of res.orders ?? []) {
        if (!isShopifySaleOrder(order)) continue;
        if (order.id == null) continue;
        for (const li of order.line_items ?? []) {
          const productId = li.product_id;
          if (productId == null || li.id == null) continue;
          const variant: Record<string, string> = {};
          if (li.variant_title?.trim()) variant.Option = li.variant_title.trim();
          for (const p of li.properties ?? []) {
            if (p.name && p.value) variant[p.name] = p.value;
          }
          sales.push({
            externalEventId: `order:${order.id}:line:${li.id}`,
            externalListingId: String(productId),
            quantitySold: Math.max(1, li.quantity ?? 1),
            sku: li.sku ?? null,
            variant: Object.keys(variant).length > 0 ? variant : null,
          });
        }
      }
      ordersPath = pageRes.nextUrl;
    }
    return sales;
  },
};
