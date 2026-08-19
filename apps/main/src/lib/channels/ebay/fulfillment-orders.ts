import { ebayGet, ebayJson } from "./client";

export type EbayFulfillmentOrderRow = {
  orderId: string;
  buyerUsername?: string;
  creationDate?: string;
  orderFulfillmentStatus?: string;
  lineItems?: {
    lineItemId?: string;
    sku?: string;
    title?: string;
    quantity?: number;
  }[];
};

export async function listAwaitingShipmentOrders(accessToken: string): Promise<EbayFulfillmentOrderRow[]> {
  const res = await ebayGet<{ orders?: EbayFulfillmentOrderRow[] }>(
    accessToken,
    `/sell/fulfillment/v1/order?filter=${encodeURIComponent("orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}")}&limit=50`
  );
  return res.orders ?? [];
}

export async function createShippingFulfillment(args: {
  accessToken: string;
  orderId: string;
  lineItems: { lineItemId: string; quantity: number }[];
  trackingNumber: string;
  shippingCarrierCode: string;
}): Promise<void> {
  await ebayJson(
    args.accessToken,
    `/sell/fulfillment/v1/order/${encodeURIComponent(args.orderId)}/shipping_fulfillment`,
    "POST",
    {
      lineItems: args.lineItems,
      shippedDate: new Date().toISOString(),
      shippingCarrierCode: args.shippingCarrierCode,
      trackingNumber: args.trackingNumber,
    }
  );
}
