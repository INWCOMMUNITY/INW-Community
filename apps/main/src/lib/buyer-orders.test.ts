import { describe, expect, it } from "vitest";
import {
  buyerFulfillmentHeadline,
  buyerItemTitle,
  buyerOrderTitle,
  buyerPaymentLabel,
  canCancelBuyerOrder,
  canRequestBuyerRefund,
  emptyBuyerTabCopy,
  formatBuyerOrderDate,
  buyerOrderGrandTotalCents,
  formatBuyerPrice,
  orderMatchesBuyerTab,
  partitionBuyerOrders,
  trackingStatusLabel,
  type BuyerStoreOrder,
} from "./buyer-orders";

function order(partial: Partial<BuyerStoreOrder> & Pick<BuyerStoreOrder, "id" | "status">): BuyerStoreOrder {
  return {
    totalCents: 100,
    createdAt: "2026-08-12T17:59:48.000Z",
    items: [],
    shipment: null,
    ...partial,
  };
}

describe("buyer order display", () => {
  it("adds tax into the buyer-facing grand total", () => {
    expect(buyerOrderGrandTotalCents({ totalCents: 100, taxCents: 6 })).toBe(106);
    expect(buyerOrderGrandTotalCents({ totalCents: 100 })).toBe(100);
  });

  it("formats price and a short date", () => {
    expect(formatBuyerPrice(100)).toBe("$1.00");
    expect(formatBuyerOrderDate("2026-08-12T17:59:48.000Z")).toMatch(/2026/);
    expect(formatBuyerOrderDate("2026-08-12T17:59:48.000Z")).not.toMatch(/:/);
  });

  it("falls back when the listing was deleted", () => {
    expect(buyerItemTitle({ id: "i", quantity: 1, priceCentsAtPurchase: 100 })).toBe(
      "Item no longer available"
    );
    expect(
      buyerItemTitle({
        id: "i",
        quantity: 1,
        priceCentsAtPurchase: 100,
        storeItem: { id: "s", title: "Mug", slug: "mug", photos: [] },
      })
    ).toBe("Mug");
    expect(
      buyerOrderTitle(
        order({
          id: "1",
          status: "paid",
          items: [
            {
              id: "a",
              quantity: 1,
              priceCentsAtPurchase: 100,
              storeItem: { id: "s", title: "Ceramic mug", slug: "mug", photos: [] },
            },
          ],
        })
      )
    ).toBe("Ceramic mug");
  });

  it("uses one payment label", () => {
    expect(buyerPaymentLabel({ isCashOrder: true })).toBe("Cash due");
    expect(buyerPaymentLabel({ isCashOrder: false })).toBe("Paid Online");
  });
});

describe("cancel vs refund", () => {
  it("allows cancel only while paid, and refund after ship", () => {
    expect(canCancelBuyerOrder({ status: "paid" })).toBe(true);
    expect(canCancelBuyerOrder({ status: "shipped" })).toBe(false);
    expect(canRequestBuyerRefund({ status: "paid", isCashOrder: false })).toBe(false);
    expect(canRequestBuyerRefund({ status: "shipped", isCashOrder: false })).toBe(true);
    expect(canRequestBuyerRefund({ status: "delivered", isCashOrder: false })).toBe(true);
    expect(canRequestBuyerRefund({ status: "shipped", isCashOrder: true })).toBe(false);
    expect(
      canRequestBuyerRefund({ status: "shipped", isCashOrder: false, refundRequestedAt: "2026-08-12" })
    ).toBe(false);
  });
});

describe("trackingStatusLabel", () => {
  it("maps Shippo statuses to buyer copy", () => {
    expect(trackingStatusLabel("TRANSIT")).toBe("In transit");
    expect(trackingStatusLabel("DELIVERED")).toBe("Delivered");
    expect(trackingStatusLabel("PRE_TRANSIT")).toBe("Label created");
    expect(trackingStatusLabel("UNKNOWN")).toBe("Label created");
    expect(trackingStatusLabel(null)).toBeNull();
  });
});

describe("buyerFulfillmentHeadline", () => {
  it("says awaiting shipment when paid with no label", () => {
    expect(
      buyerFulfillmentHeadline(
        order({
          id: "1",
          status: "paid",
          items: [{ id: "i", quantity: 1, priceCentsAtPurchase: 100, fulfillmentType: "ship" }],
        })
      )
    ).toBe("Awaiting shipment");
  });

  it("uses carrier tracking when a number exists", () => {
    expect(
      buyerFulfillmentHeadline(
        order({
          id: "1",
          status: "shipped",
          items: [{ id: "i", quantity: 1, priceCentsAtPurchase: 100, fulfillmentType: "ship" }],
          shipment: { carrier: "USPS", trackingNumber: "9400", trackingStatus: "TRANSIT" },
        })
      )
    ).toBe("In transit");
  });

  it("prompts the buyer to confirm pickup", () => {
    expect(
      buyerFulfillmentHeadline(
        order({
          id: "1",
          status: "paid",
          pickupSellerConfirmedAt: "2026-08-12T18:00:00.000Z",
          items: [{ id: "i", quantity: 1, priceCentsAtPurchase: 100, fulfillmentType: "pickup" }],
        })
      )
    ).toBe("Mark pickup received");
  });
});

describe("partitionBuyerOrders", () => {
  it("splits paid/shipped into to-receive and keeps delivered separate", () => {
    const paid = order({ id: "p", status: "paid" });
    const shipped = order({ id: "s", status: "shipped" });
    const delivered = order({ id: "d", status: "delivered" });
    const canceled = order({ id: "c", status: "canceled" });
    const refunded = order({ id: "r", status: "refunded" });
    const parts = partitionBuyerOrders([paid, shipped, delivered, canceled, refunded]);
    expect(parts.to_receive.map((o) => o.id)).toEqual(["p", "s"]);
    expect(parts.delivered.map((o) => o.id)).toEqual(["d"]);
    expect(parts.canceled.map((o) => o.id)).toEqual(["c", "r"]);
    expect(parts.all.map((o) => o.id)).toEqual(["p", "s", "d", "c", "r"]);
    expect(orderMatchesBuyerTab(paid, "to_receive")).toBe(true);
    expect(emptyBuyerTabCopy("all").title).toBe("No orders yet");
  });
});
