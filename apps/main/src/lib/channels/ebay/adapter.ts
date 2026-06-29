import type {
  ChannelAdapter,
  ChannelConnectionContext,
  CreateListingResult,
  RemoteListingSummary,
  RemoteSale,
  SyncStoreItem,
  TokenResponse,
} from "../types";
import { EbayApiError, ebayAction, ebayGet, ebayGetInventoryItem, ebayJson } from "./client";
import { describeEbayThrownError } from "./errors";
import {
  exchangeEbayCode,
  fetchEbayShopInfo,
  getEbayAuthUrl,
  refreshEbayToken,
} from "./oauth";
import { fetchEbayConnectionConfig, readEbayConfig } from "./account";
import { checkRevisionLimit, getRevisionLimitWarning, recordRevision } from "./rate-limits";
import { resolveProviderCategoryId } from "../category-map";
import { buildEbayInventoryItem, buildEbayOffer, ebayListingToSummary } from "./mapping";
import { hasOptionQuantities } from "../../store-item-variants";
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
 *
 * For INW-created listings the SKU = StoreItem.id. For imported listings the eBay-assigned
 * migrated SKU differs from item.id; callers pass it via `linkedSku` so we target the
 * correct inventory item + offer on eBay rather than creating an orphan.
 */
type UpsertResult = { sku: string; publishError?: string };

async function upsertListing(
  conn: ChannelConnectionContext,
  item: SyncStoreItem,
  linkedSku?: string
): Promise<UpsertResult> {
  const sku = linkedSku || item.id;
  const cfg = readEbayConfig(conn.config);

  // Check rate limit before making any changes
  const limitCheck = checkRevisionLimit(sku);
  if (limitCheck.atLimit) {
    const warning = getRevisionLimitWarning(sku);
    console.error("[ebay] upsertListing: rate limit reached", { sku, count: limitCheck.count });
    return { sku, publishError: warning || "eBay daily revision limit reached" };
  }
  if (limitCheck.nearLimit) {
    console.warn("[ebay] upsertListing: approaching rate limit", { sku, count: limitCheck.count });
  }

  const cat = await resolveProviderCategoryId(conn, "ebay", item.category);

  await ebayJson(
    conn.accessToken,
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    "PUT",
    buildEbayInventoryItem(item)
  );
  recordRevision(sku); // Count this as a revision

  const offerBody = buildEbayOffer(item, cfg, cat.ebayCategoryId ?? null, sku);
  const existing = await findOffer(conn.accessToken, sku);
  let offerId = existing?.offerId ?? null;
  if (offerId) {
    await ebayJson(conn.accessToken, `/sell/inventory/v1/offer/${offerId}`, "PUT", offerBody);
    recordRevision(sku); // Count offer update as a revision too
  } else {
    const created = await ebayJson<{ offerId?: string }>(
      conn.accessToken,
      `/sell/inventory/v1/offer`,
      "POST",
      offerBody
    );
    offerId = created.offerId ?? null;
    // Creating a new offer doesn't count against revision limit
  }

  const shouldPublish = cfg.canPublish && item.status === "active" && item.quantity > 0 && !!offerId;
  if (shouldPublish && offerId) {
    try {
      await publishOffer(conn.accessToken, offerId);
      recordRevision(sku); // Publishing also counts as a revision
    } catch (e) {
      const msg = describeEbayThrownError(e);
      console.error("[ebay] publish failed; left as draft", { offerId, error: msg });
      return { sku, publishError: msg };
    }
  }
  return { sku };
}

/**
 * Read-back verification: confirm the inventory quantity was actually applied.
 * This catches cases where eBay returns 200 OK but the stock didn't change.
 * @param expectedQuantity - The quantity we tried to set, or null to skip qty check (for variant listings)
 */
async function verifyInventoryWrite(
  accessToken: string,
  sku: string,
  expectedQuantity: number | null
): Promise<void> {
  // Small delay to allow eBay to propagate the write
  await new Promise((r) => setTimeout(r, 500));

  const item = await ebayGetInventoryItem(accessToken, sku);
  if (!item) {
    console.warn("[ebay] verifyInventoryWrite: inventory item not found after write", { sku });
    // Don't throw - the item might be newly created and still propagating
    return;
  }

  // For variant listings, we skip quantity check since it's per-variation
  if (expectedQuantity === null) return;

  const actualQuantity = item.availability?.shipToLocationAvailability?.quantity;
  if (actualQuantity !== undefined && actualQuantity !== expectedQuantity) {
    console.warn("[ebay] verifyInventoryWrite: quantity mismatch after write", {
      sku,
      expected: expectedQuantity,
      actual: actualQuantity,
    });
    // For now, log the mismatch but don't throw. This could be due to:
    // - Concurrent sales reducing stock
    // - eBay propagation delay
    // - API quirks
    // A future enhancement could retry or throw to trigger error state.
  }
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
    const { sku, publishError } = await upsertListing(conn, item);
    if (publishError) {
      console.warn("[ebay] createListing: inventory item + offer saved, but publish failed", {
        sku,
        publishError,
      });
    }
    return { externalListingId: sku, externalShopId: conn.externalShopId };
  },

  async updateListing(conn, externalListingId, item): Promise<void> {
    const { publishError } = await upsertListing(conn, item, externalListingId);
    if (publishError) {
      throw new Error(`eBay content updated but publish failed: ${publishError}`);
    }
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

  async updateInventory(conn, externalListingId, absoluteQuantity, item): Promise<void> {
    const sku = externalListingId;

    // Check rate limit before making any changes
    const limitCheck = checkRevisionLimit(sku);
    if (limitCheck.atLimit) {
      const warning = getRevisionLimitWarning(sku);
      throw new Error(warning || "eBay daily revision limit reached");
    }
    if (limitCheck.nearLimit) {
      console.warn("[ebay] updateInventory: approaching rate limit", { sku, count: limitCheck.count });
    }

    if (hasOptionQuantities(item.variants)) {
      await ebayJson(
        conn.accessToken,
        `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
        "PUT",
        buildEbayInventoryItem(item)
      );
      recordRevision(sku);
      // Read-back verification for variant listings
      await verifyInventoryWrite(conn.accessToken, sku, null);
      return;
    }
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
    recordRevision(sku);

    // Read-back verification: confirm the quantity was actually updated
    await verifyInventoryWrite(conn.accessToken, sku, quantity);
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
        categoryId: l.remoteCategoryId ?? null,
        categoryName: l.categoryName ?? null,
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
      );
      const orders = res?.orders ?? [];
      for (const order of orders) {
        for (const li of order.lineItems ?? []) {
          const sku = li.sku || null;
          if (!sku) {
            console.warn("[ebay] sale line without SKU (legacy listing); cannot reconcile", {
              orderId: order.orderId,
              lineItemId: li.lineItemId,
              legacyItemId: li.legacyItemId,
            });
            continue;
          }
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
