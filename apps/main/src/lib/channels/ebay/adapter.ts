import type {
  ChannelAdapter,
  ChannelConnectionContext,
  CreateListingResult,
  RemoteListingSummary,
  RemoteSale,
  SyncStoreItem,
  TokenResponse,
} from "../types";
import { EbayApiError, ebayAction, ebayGet, ebayJson } from "./client";
import {
  exchangeEbayCode,
  fetchEbayShopInfo,
  getEbayAuthUrl,
  refreshEbayToken,
} from "./oauth";
import { fetchEbayConnectionConfig, readEbayConfig } from "./account";
import { resolveProviderCategoryId } from "../category-map";
import { buildEbayInventoryItem, buildEbayOffer, ebayListingToSummary } from "./mapping";
import { enumerateEbayListings } from "./trading";
import { EBAY_MARKETPLACE_ID } from "./config";

type EbayOffer = { offerId?: string; status?: string; listing?: { listingId?: string } };
type OfferSearch = { offers?: EbayOffer[] };

/** Find the first offer for a SKU (used to resolve offerId from the stored SKU). */
async function findOffer(accessToken: string, sku: string): Promise<EbayOffer | null> {
  try {
    const res = await ebayGet<OfferSearch>(
      accessToken,
      `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${EBAY_MARKETPLACE_ID}`
    );
    return res.offers?.[0] ?? null;
  } catch (e) {
    if (e instanceof EbayApiError && e.status === 404) return null;
    throw e;
  }
}

async function publishOffer(accessToken: string, offerId: string): Promise<void> {
  await ebayAction(accessToken, `/sell/inventory/v1/offer/${offerId}/publish`, "POST");
}

/**
 * Create/update the inventory item + offer for a StoreItem and (when policies allow) publish.
 * eBay externalListingId is the SKU (= StoreItem id for items we create); offerId is resolved
 * on demand so reconciliation can match Fulfillment line items by SKU.
 */
async function upsertListing(
  conn: ChannelConnectionContext,
  item: SyncStoreItem
): Promise<string> {
  const sku = item.id;
  const cfg = readEbayConfig(conn.config);
  const cat = await resolveProviderCategoryId(conn, "ebay", item.category);

  await ebayJson(
    conn.accessToken,
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    "PUT",
    buildEbayInventoryItem(item)
  );

  const offerBody = buildEbayOffer(item, cfg, cat.ebayCategoryId ?? null);
  const existing = await findOffer(conn.accessToken, sku);
  let offerId = existing?.offerId ?? null;
  if (offerId) {
    await ebayJson(conn.accessToken, `/sell/inventory/v1/offer/${offerId}`, "PUT", offerBody);
  } else {
    const created = await ebayJson<{ offerId?: string }>(
      conn.accessToken,
      `/sell/inventory/v1/offer`,
      "POST",
      offerBody
    );
    offerId = created.offerId ?? null;
  }

  // Publish best-effort, mirroring Etsy's draft fallback: if policies/location are missing or
  // eBay rejects publish (e.g. category-specific required aspects), the offer is left as an
  // unpublished draft on eBay but the StoreItem still gets linked here so it stays in sync.
  // The Sync Stores screen surfaces the "add business policies + location" readiness warning.
  const shouldPublish = cfg.canPublish && item.status === "active" && item.quantity > 0 && !!offerId;
  if (shouldPublish && offerId) {
    try {
      await publishOffer(conn.accessToken, offerId);
    } catch (e) {
      console.error("[ebay] publish failed; left as draft", { offerId, error: String(e) });
    }
  }
  return sku;
}

export const ebayAdapter: ChannelAdapter = {
  provider: "ebay",

  getAuthUrl: getEbayAuthUrl,

  exchangeCode(args): Promise<TokenResponse> {
    return exchangeEbayCode(args);
  },

  refreshAccessToken(refreshToken): Promise<TokenResponse> {
    return refreshEbayToken(refreshToken);
  },

  fetchShopInfo(accessToken) {
    return fetchEbayShopInfo(accessToken);
  },

  async getInitialConfig(accessToken): Promise<Record<string, unknown>> {
    const cfg = await fetchEbayConnectionConfig(accessToken);
    return { ...cfg };
  },

  async createListing(conn, item): Promise<CreateListingResult> {
    const sku = await upsertListing(conn, item);
    return { externalListingId: sku, externalShopId: conn.externalShopId };
  },

  async updateListing(conn, _externalListingId, item): Promise<void> {
    await upsertListing(conn, item);
  },

  async deleteListing(conn, externalListingId): Promise<void> {
    const sku = externalListingId;
    const offer = await findOffer(conn.accessToken, sku).catch(() => null);
    if (offer?.offerId) {
      try {
        await ebayAction(conn.accessToken, `/sell/inventory/v1/offer/${offer.offerId}/withdraw`, "POST");
      } catch (e) {
        if (!(e instanceof EbayApiError && e.status === 404)) throw e;
      }
    }
    try {
      await ebayAction(
        conn.accessToken,
        `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
        "DELETE"
      );
    } catch (e) {
      if (!(e instanceof EbayApiError && e.status === 404)) throw e;
    }
  },

  async updateInventory(conn, externalListingId, absoluteQuantity): Promise<void> {
    const sku = externalListingId;
    const quantity = Math.max(0, absoluteQuantity);
    const offer = await findOffer(conn.accessToken, sku).catch(() => null);
    const request: Record<string, unknown> = {
      sku,
      shipToLocationAvailability: { quantity },
    };
    if (offer?.offerId) {
      request.offers = [{ offerId: offer.offerId, availableQuantity: quantity }];
    }
    await ebayJson(conn.accessToken, `/sell/inventory/v1/bulk_update_price_quantity`, "POST", {
      requests: [request],
    });
  },

  async listRemoteListings(conn): Promise<RemoteListingSummary[]> {
    const listings = await enumerateEbayListings(conn.accessToken);
    return listings.map((l) =>
      ebayListingToSummary({
        listingId: l.listingId,
        title: l.title,
        price: { value: (l.priceCents / 100).toFixed(2), currency: "USD" },
        availableQuantity: l.quantity,
        imageUrls: l.photos,
      })
    );
  },

  async fetchRecentSales(conn, since): Promise<RemoteSale[]> {
    const sinceIso = since.toISOString();
    const sales: RemoteSale[] = [];
    let offset = 0;
    for (let page = 0; page < 5; page += 1) {
      const res = await ebayGet<{
        orders?: {
          orderId?: string;
          lineItems?: {
            lineItemId?: string;
            sku?: string;
            legacyItemId?: string;
            quantity?: number;
          }[];
        }[];
        total?: number;
      }>(
        conn.accessToken,
        `/sell/fulfillment/v1/order?filter=creationdate:%5B${encodeURIComponent(sinceIso)}..%5D&limit=200&offset=${offset}`
      ).catch(() => null);
      const orders = res?.orders ?? [];
      for (const order of orders) {
        for (const li of order.lineItems ?? []) {
          const sku = li.sku || null;
          if (!sku) continue; // only inventory-model listings (created/migrated) carry a SKU
          sales.push({
            externalEventId: `order:${order.orderId}:line:${li.lineItemId}`,
            externalListingId: sku,
            quantitySold: Math.max(1, li.quantity ?? 1),
            sku,
          });
        }
      }
      if (orders.length < 200) break;
      offset += 200;
    }
    return sales;
  },
};
