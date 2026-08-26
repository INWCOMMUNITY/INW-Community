import { describe, expect, it } from "vitest";
import { isShippoTrackingDelivered } from "./shippo-tracking-status";
import { nextStatusAfterFulfillmentConfirmations } from "./store-order-fulfillment";
import { isSoldWhilePayingCancel, SOLD_BEFORE_CHECKOUT_REASON } from "./store-order-cancel-reasons";

describe("isShippoTrackingDelivered", () => {
  it("recognizes DELIVERED so auto-complete can fire", () => {
    expect(isShippoTrackingDelivered("DELIVERED")).toBe(true);
    expect(isShippoTrackingDelivered("TRANSIT")).toBe(false);
  });
});

describe("nextStatusAfterFulfillmentConfirmations mixed cart", () => {
  it("completes the ship leg when tracking is DELIVERED and pickup is confirmed", () => {
    expect(
      nextStatusAfterFulfillmentConfirmations(
        {
          status: "shipped",
          pickupSellerConfirmedAt: new Date(),
          pickupBuyerConfirmedAt: new Date(),
        },
        [{ fulfillmentType: "ship" }, { fulfillmentType: "pickup" }],
        { trackingStatus: "DELIVERED", status: "delivered" }
      )
    ).toBe("delivered");
  });

  it("does not mark delivered while tracking is still in transit", () => {
    expect(
      nextStatusAfterFulfillmentConfirmations(
        { status: "shipped" },
        [{ fulfillmentType: "ship" }],
        { trackingStatus: "TRANSIT", status: "shipped" }
      )
    ).toBeUndefined();
  });
});

describe("sold-while-paying copy", () => {
  it("detects the checkout race cancel reason", () => {
    expect(isSoldWhilePayingCancel(SOLD_BEFORE_CHECKOUT_REASON)).toBe(true);
    expect(isSoldWhilePayingCancel("Buyer canceled")).toBe(false);
  });
});
