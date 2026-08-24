import { ebayJson } from "./client";
import { buildPassthroughLiveOverlayBody, fetchLiveInventoryItem } from "./passthrough-push";

/**
 * eBay `bulk_update_price_quantity` with availableQuantity 0 often returns HTTP 400 / #25002
 * (offer + inventory in one payload). Sell-out writes PUT the inventory item only.
 */
export async function pushEbayAbsoluteQuantity(args: {
  accessToken: string;
  sku: string;
  quantity: number;
  offerId?: string | null;
}): Promise<void> {
  const quantity = Math.max(0, Math.round(args.quantity));
  if (quantity <= 0) {
    await pushEbayZeroQuantity(args.accessToken, args.sku);
    return;
  }

  const request: Record<string, unknown> = {
    sku: args.sku,
    shipToLocationAvailability: { quantity },
  };
  if (args.offerId) {
    request.offers = [{ offerId: args.offerId, availableQuantity: quantity }];
  }
  await ebayJson(args.accessToken, `/sell/inventory/v1/bulk_update_price_quantity`, "POST", {
    requests: [request],
  });
}

async function pushEbayZeroQuantity(accessToken: string, sku: string): Promise<void> {
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

  await ebayJson(accessToken, `/sell/inventory/v1/bulk_update_price_quantity`, "POST", {
    requests: [{ sku, shipToLocationAvailability: { quantity: 0 } }],
  });
}
