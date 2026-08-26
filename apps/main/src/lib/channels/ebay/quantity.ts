import { ebayGet, ebayJson } from "./client";
import { EbayApiError, formatEbayApiErrorMessage } from "./errors";
import {
  buildPassthroughLiveOverlayBody,
  fetchLiveInventoryItem,
  overlayOfferAvailableQuantity,
} from "./passthrough-push";

const BULK_QTY_PATH = "/sell/inventory/v1/bulk_update_price_quantity";

/**
 * eBay `bulk_update_price_quantity` with inventory + offer availableQuantity 0 often
 * returns HTTP 400 / #25002. Live listings still use offer.availableQuantity — inventory
 * PUT alone does not take them down. Sell-out writes the offer first (offer-only bulk,
 * then PUT offer), then the inventory record.
 */
export async function pushEbayAbsoluteQuantity(args: {
  accessToken: string;
  sku: string;
  quantity: number;
  offerId?: string | null;
}): Promise<void> {
  const quantity = Math.max(0, Math.round(args.quantity));
  if (quantity <= 0) {
    await pushEbayZeroQuantity(args.accessToken, args.sku, args.offerId);
    return;
  }

  const request: Record<string, unknown> = {
    sku: args.sku,
    shipToLocationAvailability: { quantity },
  };
  if (args.offerId) {
    request.offers = [{ offerId: args.offerId, availableQuantity: quantity }];
  }
  const body = await ebayJson(args.accessToken, BULK_QTY_PATH, "POST", {
    requests: [request],
  });
  assertBulkPriceQuantityOk(body, BULK_QTY_PATH);
}

async function pushEbayZeroQuantity(
  accessToken: string,
  sku: string,
  offerId?: string | null
): Promise<void> {
  let offerZeroed = false;
  if (offerId) {
    await pushEbayZeroOfferQuantity(accessToken, sku, offerId);
    offerZeroed = true;
  }

  try {
    await pushEbayZeroInventoryQuantity(accessToken, sku);
  } catch (e) {
    if (offerZeroed) {
      console.warn("[ebay] inventory qty 0 put failed after offer was zeroed", {
        sku,
        offerId,
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    throw e;
  }
}

async function pushEbayZeroOfferQuantity(
  accessToken: string,
  sku: string,
  offerId: string
): Promise<void> {
  try {
    const body = await ebayJson(accessToken, BULK_QTY_PATH, "POST", {
      requests: [{ sku, offers: [{ offerId, availableQuantity: 0 }] }],
    });
    assertBulkPriceQuantityOk(body, BULK_QTY_PATH);
    return;
  } catch (e) {
    console.warn("[ebay] offer-only bulk qty 0 failed; PUT offer", {
      sku,
      offerId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const live = await ebayGet<Record<string, unknown>>(
    accessToken,
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`
  );
  await ebayJson(
    accessToken,
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
    "PUT",
    overlayOfferAvailableQuantity(live, 0)
  );
}

async function pushEbayZeroInventoryQuantity(accessToken: string, sku: string): Promise<void> {
  const live = await fetchLiveInventoryItem(accessToken, sku);
  if (live) {
    const body = buildPassthroughLiveOverlayBody(live, { quantity: 0 });
    await ebayJson(
      accessToken,
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      "PUT",
      body
    );
    return;
  }

  const body = await ebayJson(accessToken, BULK_QTY_PATH, "POST", {
    requests: [{ sku, shipToLocationAvailability: { quantity: 0 } }],
  });
  assertBulkPriceQuantityOk(body, BULK_QTY_PATH);
}

/** bulk_update_price_quantity returns HTTP 200 with per-row statusCode 400. */
export function assertBulkPriceQuantityOk(body: unknown, path: string): void {
  if (!body || typeof body !== "object") return;
  const responses = (body as { responses?: { statusCode?: number }[] }).responses;
  if (!Array.isArray(responses) || responses.length === 0) return;
  const failed = responses.find((row) => (row.statusCode ?? 200) >= 400);
  if (!failed) return;
  const status = failed.statusCode ?? 400;
  throw new EbayApiError(formatEbayApiErrorMessage(body, status, path), status, body, path);
}
