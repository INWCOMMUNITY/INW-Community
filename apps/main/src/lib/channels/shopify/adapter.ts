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
  setShopifyConnectionContext,
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
  quantityForShopifyRemoteVariant,
  type ShopifyProduct,
} from "./mapping";
import { fetchShopifyCollectionCategoryMaps } from "./collections";
import { fetchShopifyProductTaxonomyMaps } from "./inbound-taxonomy";
import { applyShopifyCategory } from "./taxonomy";
import { hasOptionQuantities } from "../../store-item-variants";
import {
  comboInventoryFailedMessage,
  expectedComboSkuCount,
  IncompleteChannelListingError,
} from "../combo-sync";
import { isShopifySaleOrder } from "./sale-order";
import { ensureShopifyWebhooks } from "./webhooks-subscribe";

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

async function readShopifyAvailable(
  accessToken: string,
  shop: string,
  apiVersion: string,
  inventoryItemId: number,
  locationId: string
): Promise<number | null> {
  try {
    const res = await shopifyGet<{
      inventory_levels?: { available?: number | null; location_id?: number }[];
    }>(
      accessToken,
      shop,
      apiVersion,
      `/inventory_levels.json?inventory_item_ids=${inventoryItemId}&location_ids=${locationId}`
    );
    const level = res.inventory_levels?.[0];
    if (level && typeof level.available === "number") return level.available;
    return null;
  } catch {
    return null;
  }
}

async function syncProductInventory(
  conn: ChannelConnectionContext,
  productId: string,
  absoluteQuantity: number,
  opts?: { strict?: boolean; verify?: boolean }
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
  const qty = Math.max(0, Math.round(absoluteQuantity));
  await setInventoryAbsolute(
    conn.accessToken,
    cfg.shop,
    cfg.apiVersion,
    cfg.locationId,
    inventoryItemId,
    qty
  );
  if (opts?.verify) {
    await new Promise((r) => setTimeout(r, 400));
    const actual = await readShopifyAvailable(
      conn.accessToken,
      cfg.shop,
      cfg.apiVersion,
      inventoryItemId,
      cfg.locationId
    );
    if (actual != null && actual !== qty) {
      throw new Error(
        `Shopify inventory verify failed for product ${productId}: expected ${qty}, got ${actual}`
      );
    }
  }
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
  for (const v of existing.variants) {
    if (v.inventory_item_id == null) continue;
    const qty = quantityForShopifyRemoteVariant(item, existing, v);
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
    const webhooks = await ensureShopifyWebhooks({
      accessToken,
      shop,
      apiVersion,
    }).catch((e) => ({
      address: null as string | null,
      topics: [] as string[],
      created: [] as string[],
      error: e instanceof Error ? e.message : String(e),
    }));
    if (webhooks.error) {
      console.warn("[shopify] webhook subscribe on connect failed", { shop, error: webhooks.error });
    }
    return {
      shop,
      locationId,
      apiVersion,
      shopifyWebhookAddress: webhooks.address,
      shopifyWebhooksRegisteredAt: webhooks.error ? null : new Date().toISOString(),
      shopifyWebhooksError: webhooks.error,
      shopifyWebhookTopics: webhooks.topics,
    };
  },

  async createListing(conn, item): Promise<CreateListingResult> {
    setShopifyConnectionContext(conn.id);
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
    const expectedCombos = expectedComboSkuCount(item.variants);
    try {
      if (cfg.locationId) {
        const product = res.product;
        const variants = product?.variants ?? [];
        if (expectedCombos > 1 && variants.length < expectedCombos) {
          throw new Error(comboInventoryFailedMessage("shopify"));
        }
        if (variants.length > 1) {
          for (const v of variants) {
            if (v.inventory_item_id == null) continue;
            const qty = quantityForShopifyRemoteVariant(item, product ?? {}, v);
            await setInventoryAbsolute(
              conn.accessToken,
              cfg.shop,
              cfg.apiVersion,
              cfg.locationId,
              v.inventory_item_id,
              qty
            );
          }
        } else {
          await syncProductInventory(conn, pid, item.quantity);
        }
      }
      await applyShopifyCategory(conn, pid, item).catch((e) => {
        console.warn("[shopify] post-create category apply failed", {
          productId: pid,
          error: String(e),
        });
      });
      return { externalListingId: pid, externalShopId: cfg.shop };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      let rolledBack = false;
      try {
        await shopifyDelete(
          conn.accessToken,
          cfg.shop,
          cfg.apiVersion,
          `/products/${pid}.json`
        );
        rolledBack = true;
      } catch (del) {
        if (!(del instanceof ShopifyApiError && del.status === 404)) {
          console.warn("[shopify] rollback after incomplete create failed", {
            productId: pid,
            error: String(del),
          });
        } else {
          rolledBack = true;
        }
      }
      throw new IncompleteChannelListingError(
        msg.includes("combinations") ? msg : `${comboInventoryFailedMessage("shopify")} (${msg.slice(0, 200)})`,
        pid,
        rolledBack
      );
    }
  },

  async updateListing(conn, externalListingId, item): Promise<void> {
    setShopifyConnectionContext(conn.id);
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
      const expected = expectedComboSkuCount(item.variants);
      if (expected > 1) {
        const after = await getProduct(conn.accessToken, cfg.shop, cfg.apiVersion, externalListingId);
        if ((after?.variants?.length ?? 0) < expected) {
          throw new Error(comboInventoryFailedMessage("shopify"));
        }
      }
    } else {
      await syncProductInventory(conn, externalListingId, item.quantity);
    }
    await applyShopifyCategory(conn, externalListingId, item).catch((e) => {
      console.warn("[shopify] post-update category apply failed", {
        productId: externalListingId,
        error: String(e),
      });
    });
  },

  async deleteListing(conn, externalListingId): Promise<void> {
    setShopifyConnectionContext(conn.id);
    const cfg = connCfg(conn);
    if (!cfg.shop) {
      throw new Error("Shopify is missing a shop domain. Reconnect Shopify in Sync Stores.");
    }
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
    setShopifyConnectionContext(conn.id);
    if (hasOptionQuantities(item.variants)) {
      await syncShopifyVariantInventory(conn, externalListingId, item);
      return;
    }
    await syncProductInventory(conn, externalListingId, absoluteQuantity, {
      strict: true,
      verify: true,
    });
  },

  async fetchProductQuantity(
    conn,
    externalListingId
  ): Promise<{ quantity: number; known: boolean }> {
    setShopifyConnectionContext(conn.id);
    const cfg = connCfg(conn);
    if (!cfg.shop || !cfg.locationId) return { quantity: 0, known: false };
    const product = await getProduct(
      conn.accessToken,
      cfg.shop,
      cfg.apiVersion,
      externalListingId
    );
    if (!product) return { quantity: 0, known: false };
    const status = (product.status ?? "active").toLowerCase();
    if (status === "draft" || status === "archived") {
      return { quantity: 0, known: true };
    }
    let total = 0;
    let known = false;
    for (const v of product.variants ?? []) {
      if (v.inventory_item_id == null) continue;
      const available = await readShopifyAvailable(
        conn.accessToken,
        cfg.shop,
        cfg.apiVersion,
        v.inventory_item_id,
        cfg.locationId
      );
      if (available != null) {
        total += available;
        known = true;
      } else if (typeof v.inventory_quantity === "number") {
        total += Math.max(0, v.inventory_quantity);
        known = true;
      }
    }
    return { quantity: total, known };
  },

  async listRemoteListings(conn): Promise<RemoteListingSummary[]> {
    setShopifyConnectionContext(conn.id);
    const cfg = connCfg(conn);
    if (!cfg.shop) return [];
    const summaries: RemoteListingSummary[] = [];
    const [collectionByProductId, taxonomyByProductId] = await Promise.all([
      fetchShopifyCollectionCategoryMaps(conn.accessToken, cfg.shop, cfg.apiVersion).catch(
        () => new Map<string, string>()
      ),
      fetchShopifyProductTaxonomyMaps(conn.accessToken, cfg.shop, cfg.apiVersion).catch(
        () => new Map()
      ),
    ]);
    // Active only — draft/archived treated as removed by baseline reconciler.
    let path: string | null = "/products.json?limit=250&status=active";
    for (let page = 0; page < 20 && path; page += 1) {
      const currentPath = path;
      const pageRes: ShopifyGetResult<ProductsResponse> = await shopifyGetWithPagination(
        conn.accessToken,
        cfg.shop,
        cfg.apiVersion,
        currentPath
      );
      for (const p of pageRes.data.products ?? []) {
        const pid = p.id != null ? String(p.id) : null;
        const collectionName = pid ? collectionByProductId.get(pid) ?? null : null;
        const taxonomy = pid ? taxonomyByProductId.get(pid) ?? null : null;
        const s = shopifyProductToSummary(p, collectionName, taxonomy);
        if (s.externalListingId) summaries.push(s);
      }
      path = pageRes.nextUrl;
    }
    return summaries;
  },

  async fetchRecentSales(conn, since): Promise<RemoteSale[]> {
    setShopifyConnectionContext(conn.id);
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
