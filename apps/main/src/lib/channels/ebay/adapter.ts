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
import {
  checkRevisionLimit,
  getRevisionLimitWarning,
  hydrateRevisionCountsFromConfig,
  persistRevisionCount,
} from "./rate-limits";
import { resolveProviderCategoryId } from "../category-map";
import { buildEbayInventoryItem, buildEbayOffer, ebayListingToSummary, resolveCategoryId } from "./mapping";
import { isEbayConditionSyncError } from "./conditions";
import {
  enrichSyncItemConditionFromEbay,
  prepareEbaySyncCondition,
} from "./fix-condition";
import {
  formatMissingEbayAspectsError,
  persistEbayAspects,
  prepareEbaySyncAspects,
} from "./sync-aspects";
import { parseStoredAspects } from "@/lib/listing-limits";
import { hasOptionQuantities } from "../../store-item-variants";
import {
  enumerateEbayListings,
  fetchEbayItemDetails,
  subscribeToEbayNotifications,
} from "./trading";
import { EBAY_MARKETPLACE_ID } from "./config";
import { getBaseUrl } from "@/lib/get-base-url";

type EbayOffer = { offerId?: string; status?: string; listing?: { listingId?: string } };
type EbayOfferDetails = { offerId?: string; categoryId?: string };
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

async function getOfferDetails(
  accessToken: string,
  offerId: string
): Promise<EbayOfferDetails | null> {
  try {
    return await ebayGet<EbayOfferDetails>(
      accessToken,
      `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`
    );
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
  hydrateRevisionCountsFromConfig(conn.config);

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
  const targetCategoryId = resolveCategoryId(item, cat.ebayCategoryId ?? null);

  let workingItem = await enrichSyncItemConditionFromEbay(conn.accessToken, linkedSku ?? sku, item);

  const existingOffer = await findOffer(conn.accessToken, sku);
  let offerId = existingOffer?.offerId ?? null;
  let existingOfferCategoryId: string | null = null;
  if (offerId) {
    const offerDetails = await getOfferDetails(conn.accessToken, offerId);
    existingOfferCategoryId = offerDetails?.categoryId?.trim() ?? null;
  }

  // eBay validates inventory condition against the offer's primary category — use target if set, else live offer cat.
  const conditionCategoryId = targetCategoryId ?? existingOfferCategoryId;

  let prepared = await prepareEbaySyncCondition({
    accessToken: conn.accessToken,
    storeItemId: item.id,
    item: workingItem,
    categoryId: conditionCategoryId,
  });
  let syncItem = prepared.item;

  const aspectPrep = await prepareEbaySyncAspects({
    accessToken: conn.accessToken,
    externalListingId: linkedSku ?? sku,
    item: syncItem,
    categoryId: conditionCategoryId,
  });
  syncItem = aspectPrep.item;
  if (aspectPrep.enriched) {
    await persistEbayAspects(item.id, parseStoredAspects(syncItem.aspects));
  }
  if (aspectPrep.missingRequired.length > 0) {
    throw new Error(formatMissingEbayAspectsError(aspectPrep.missingRequired));
  }

  console.warn("[ebay] upsertListing condition", {
    storeItemId: item.id,
    sku,
    targetCategoryId,
    existingOfferCategoryId,
    conditionCategoryId,
    syncConditionEnum: prepared.conditionEnum,
    autoCorrected: prepared.autoCorrected,
    enrichedFromEbay: workingItem.ebayConditionEnum !== item.ebayConditionEnum,
    hasExistingOffer: !!offerId,
    aspectsEnriched: aspectPrep.enriched,
    aspectCount: parseStoredAspects(syncItem.aspects).length,
  });

  async function pushOfferBody(body: Record<string, unknown>) {
    if (offerId) {
      await ebayJson(conn.accessToken, `/sell/inventory/v1/offer/${offerId}`, "PUT", body);
      await persistRevisionCount(conn.id, sku, conn.config);
      return;
    }
    const created = await ebayJson<{ offerId?: string }>(
      conn.accessToken,
      `/sell/inventory/v1/offer`,
      "POST",
      body
    );
    offerId = created.offerId ?? null;
  }

  async function pushInventoryBody(body: Record<string, unknown>) {
    // #region agent log
    const productAspects = (body.product as { aspects?: Record<string, string[]> } | undefined)
      ?.aspects;
    fetch("http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "58be99" },
      body: JSON.stringify({
        sessionId: "58be99",
        location: "adapter.ts:pushInventoryBody",
        message: "inventory push aspects",
        data: {
          sku,
          aspectKeys: productAspects ? Object.keys(productAspects) : [],
          numericalGrade: productAspects?.["Numerical grade"] ?? null,
        },
        timestamp: Date.now(),
        hypothesisId: "H4",
      }),
    }).catch(() => {});
    // #endregion
    await ebayJson(
      conn.accessToken,
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      "PUT",
      body
    );
    await persistRevisionCount(conn.id, sku, conn.config);
  }

  const offerBody = buildEbayOffer(syncItem, cfg, cat.ebayCategoryId ?? null, sku);

  // Existing offers: set category on the offer before updating inventory condition (eBay #25021).
  if (offerId) {
    await pushOfferBody(offerBody);
    try {
      await pushInventoryBody(buildEbayInventoryItem(syncItem));
    } catch (e) {
      const msg = describeEbayThrownError(e);
      if (!isEbayConditionSyncError(msg)) throw e;
      prepared = await prepareEbaySyncCondition({
        accessToken: conn.accessToken,
        storeItemId: item.id,
        item: syncItem,
        categoryId: targetCategoryId ?? existingOfferCategoryId,
      });
      syncItem = prepared.item;
      console.warn("[ebay] upsertListing condition retry after 25021", {
        storeItemId: item.id,
        sku,
        syncConditionEnum: prepared.conditionEnum,
      });
      await pushInventoryBody(buildEbayInventoryItem(syncItem));
    }
  } else {
    await pushInventoryBody(buildEbayInventoryItem(syncItem));
    await pushOfferBody(offerBody);
  }

  const shouldPublish = cfg.canPublish && item.status === "active" && item.quantity > 0 && !!offerId;
  if (shouldPublish && offerId) {
    try {
      await publishOffer(conn.accessToken, offerId);
      await persistRevisionCount(conn.id, sku, conn.config);
    } catch (e) {
      const msg = describeEbayThrownError(e);
      if (isEbayConditionSyncError(msg)) {
        prepared = await prepareEbaySyncCondition({
          accessToken: conn.accessToken,
          storeItemId: item.id,
          item: syncItem,
          categoryId: targetCategoryId ?? existingOfferCategoryId,
        });
        syncItem = prepared.item;
        console.warn("[ebay] upsertListing publish retry after 25021", {
          storeItemId: item.id,
          sku,
          syncConditionEnum: prepared.conditionEnum,
        });
        await pushInventoryBody(buildEbayInventoryItem(syncItem));
        await publishOffer(conn.accessToken, offerId);
        await persistRevisionCount(conn.id, sku, conn.config);
      } else {
        console.error("[ebay] publish failed; left as draft", { offerId, error: msg });
        return { sku, publishError: msg };
      }
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
    // One retry after a longer delay for eBay propagation.
    await new Promise((r) => setTimeout(r, 800));
    const retry = await ebayGetInventoryItem(accessToken, sku);
    const retryQty = retry?.availability?.shipToLocationAvailability?.quantity;
    if (retryQty !== undefined && retryQty !== expectedQuantity) {
      throw new Error(
        `eBay inventory verify failed for SKU ${sku}: expected ${expectedQuantity}, got ${retryQty}`
      );
    }
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

    // Subscribe to eBay Platform Notifications for real-time sync
    const webhookUrl = `${getBaseUrl()}/api/channels/ebay/webhook`;
    const notifResult = await subscribeToEbayNotifications(accessToken, webhookUrl);

    return {
      ...cfg,
      notificationsEnabled: notifResult.success,
      notificationsWebhookUrl: notifResult.success ? webhookUrl : undefined,
      notificationsEnabledAt: notifResult.success ? new Date().toISOString() : undefined,
      notificationsError: notifResult.error,
    };
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
      if (isEbayConditionSyncError(publishError)) {
        throw new Error(publishError);
      }
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
    hydrateRevisionCountsFromConfig(conn.config);

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
      await persistRevisionCount(conn.id, sku, conn.config);
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
    await persistRevisionCount(conn.id, sku, conn.config);

    // Read-back verification: confirm the quantity was actually updated
    await verifyInventoryWrite(conn.accessToken, sku, quantity);
  },

  async listRemoteListings(conn, opts?: { skipPhotoEnrichment?: boolean }): Promise<RemoteListingSummary[]> {
    const listings = await enumerateEbayListings(conn.accessToken, {
      skipPhotoEnrichment: opts?.skipPhotoEnrichment,
    });
    return listings.map((l) =>
      ebayListingToSummary({
        listingId: l.listingId,
        title: l.title,
        price: { value: (l.priceCents / 100).toFixed(2), currency: "USD" },
        availableQuantity: l.quantity,
        imageUrls: l.photos,
        categoryId: l.remoteCategoryId ?? null,
        categoryName: l.categoryName ?? null,
        remoteUpdatedAt: l.remoteUpdatedAt ?? null,
        sku: l.sku ?? undefined,
      })
    );
  },

  async fetchProductQuantity(
    conn,
    externalListingId
  ): Promise<{ quantity: number; known: boolean }> {
    let legacyId = externalListingId;
    const inwMatch = legacyId.match(/^inw(\d+)$/);
    if (inwMatch) legacyId = inwMatch[1];

    // Prefer Inventory API for INW-created SKUs; fall back to Trading GetItem for classic IDs.
    const inv = await ebayGetInventoryItem(conn.accessToken, externalListingId).catch(() => null);
    const invQty = inv?.availability?.shipToLocationAvailability?.quantity;
    if (typeof invQty === "number") {
      return { quantity: Math.max(0, invQty), known: true };
    }

    if (/^\d+$/.test(legacyId)) {
      const details = await fetchEbayItemDetails(conn.accessToken, legacyId);
      if (details.quantity != null) {
        return { quantity: details.quantity, known: true };
      }
    }
    return { quantity: 0, known: false };
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
