import { describe, expect, it } from "vitest";
import {
  buyerCanRequestRefund,
  clampAcceptReturnsDays,
  isActiveStoreReturnStatus,
  isAwaitingReturnStatus,
  isReturnReceiveRefundRetryable,
  isReturnWindowOpen,
  orderCanBuyReturnLabel,
  returnRefundAmountCents,
  returnWindowEndsAt,
  postReturnSellerEntitlementCents,
  sellerTransferReversalCents,
  storeReturnBuyerLabel,
  storeReturnSellerMoneyAction,
  storeReturnSellerMoneyActionLabel,
  STORE_RETURN_RECEIVE_ACTION_LABEL,
  STORE_RETURN_RETRY_REFUND_ACTION_LABEL,
} from "./store-return";

describe("return refund math", () => {
  it("refunds the full charge when return shipping is not charged", () => {
    expect(
      returnRefundAmountCents({
        totalCents: 10000,
        taxCents: 100,
        chargeReturnShipping: false,
        returnLabelCostCents: 850,
      })
    ).toBe(10100);
  });

  it("deducts the return label when chargeReturnShipping is on", () => {
    expect(
      returnRefundAmountCents({
        totalCents: 10000,
        taxCents: 100,
        chargeReturnShipping: true,
        returnLabelCostCents: 850,
      })
    ).toBe(9250);
  });

  it("does not go below zero", () => {
    expect(
      returnRefundAmountCents({
        totalCents: 500,
        taxCents: 0,
        chargeReturnShipping: true,
        returnLabelCostCents: 900,
      })
    ).toBe(0);
  });

  it("keeps the label amount in the seller transfer when charging return shipping", () => {
    expect(
      sellerTransferReversalCents({
        originalTransferCents: 9400,
        chargeReturnShipping: true,
        returnLabelCostCents: 800,
      })
    ).toBe(8600);
    expect(
      sellerTransferReversalCents({
        originalTransferCents: 9400,
        chargeReturnShipping: false,
        returnLabelCostCents: 800,
      })
    ).toBe(9400);
  });

  it("post-return seller entitlement is original minus reversal ($100/$10)", () => {
    expect(
      postReturnSellerEntitlementCents({
        originalTransferCents: 9900,
        chargeReturnShipping: true,
        returnLabelCostCents: 1000,
      })
    ).toBe(1000);
  });

  it("caps post-return entitlement at the original transfer when the label is larger ($5/$9)", () => {
    expect(
      postReturnSellerEntitlementCents({
        originalTransferCents: 495,
        chargeReturnShipping: true,
        returnLabelCostCents: 900,
      })
    ).toBe(495);
  });

  it("is zero when return shipping is not charged or the label is zero", () => {
    expect(
      postReturnSellerEntitlementCents({
        originalTransferCents: 9900,
        chargeReturnShipping: false,
        returnLabelCostCents: 1000,
      })
    ).toBe(0);
    expect(
      postReturnSellerEntitlementCents({
        originalTransferCents: 9900,
        chargeReturnShipping: true,
        returnLabelCostCents: 0,
      })
    ).toBe(0);
  });

  it("equals the original transfer when the label equals the payout", () => {
    expect(
      postReturnSellerEntitlementCents({
        originalTransferCents: 495,
        chargeReturnShipping: true,
        returnLabelCostCents: 495,
      })
    ).toBe(495);
  });

  it("is zero when the original transfer is zero", () => {
    expect(
      postReturnSellerEntitlementCents({
        originalTransferCents: 0,
        chargeReturnShipping: true,
        returnLabelCostCents: 1000,
      })
    ).toBe(0);
  });
});

describe("return status", () => {
  it("treats requested and awaiting as active", () => {
    expect(isActiveStoreReturnStatus("requested")).toBe(true);
    expect(isActiveStoreReturnStatus("awaiting_return")).toBe(true);
    expect(isActiveStoreReturnStatus("declined")).toBe(false);
    expect(isAwaitingReturnStatus("awaiting_return")).toBe(true);
    expect(isAwaitingReturnStatus("requested")).toBe(false);
    expect(isAwaitingReturnStatus("received")).toBe(false);
    expect(isReturnReceiveRefundRetryable("awaiting_return")).toBe(true);
    expect(isReturnReceiveRefundRetryable("in_transit")).toBe(true);
    expect(isReturnReceiveRefundRetryable("received")).toBe(true);
    expect(isReturnReceiveRefundRetryable("refunded")).toBe(false);
    expect(isReturnReceiveRefundRetryable("requested")).toBe(false);
  });

  it("allows a buyer request after ship, and again after a decline", () => {
    expect(buyerCanRequestRefund({ status: "paid", isCashOrder: false })).toBe(false);
    expect(buyerCanRequestRefund({ status: "shipped", isCashOrder: false })).toBe(true);
    expect(buyerCanRequestRefund({ status: "shipped", isCashOrder: false, sellerAcceptsReturns: false })).toBe(
      false
    );
    expect(
      buyerCanRequestRefund({
        status: "shipped",
        isCashOrder: false,
        storeReturn: { status: "requested" },
      })
    ).toBe(false);
    expect(
      buyerCanRequestRefund({
        status: "delivered",
        isCashOrder: false,
        storeReturn: { status: "declined" },
      })
    ).toBe(true);
    expect(
      buyerCanRequestRefund({
        status: "delivered",
        isCashOrder: false,
        storeReturn: { status: "received" },
      })
    ).toBe(false);
    expect(
      buyerCanRequestRefund({
        status: "delivered",
        isCashOrder: false,
        storeReturn: { status: "refunded" },
      })
    ).toBe(false);
  });

  it("blocks requests after the seller return window", () => {
    const delivered = new Date("2026-08-01T00:00:00.000Z");
    const now = new Date("2026-09-15T00:00:00.000Z");
    expect(
      buyerCanRequestRefund(
        {
          status: "delivered",
          isCashOrder: false,
          sellerAcceptsReturns: true,
          sellerAcceptsReturnsDays: 30,
          deliveryConfirmedAt: delivered,
          deliveryBuyerConfirmedAt: delivered,
          items: [{ fulfillmentType: "local_delivery" }],
        },
        now
      )
    ).toBe(false);
    expect(
      buyerCanRequestRefund(
        {
          status: "delivered",
          isCashOrder: false,
          sellerAcceptsReturns: true,
          sellerAcceptsReturnsDays: 30,
          deliveryConfirmedAt: delivered,
          deliveryBuyerConfirmedAt: delivered,
          items: [{ fulfillmentType: "local_delivery" }],
        },
        new Date("2026-08-20T00:00:00.000Z")
      )
    ).toBe(true);
  });

  it("starts the pickup window from the later confirmation", () => {
    const end = returnWindowEndsAt(
      {
        items: [{ fulfillmentType: "pickup" }],
        pickupSellerConfirmedAt: "2026-09-01T00:00:00.000Z",
        pickupBuyerConfirmedAt: "2026-09-03T00:00:00.000Z",
      },
      10
    );
    expect(end?.toISOString().startsWith("2026-09-13")).toBe(true);
    expect(
      isReturnWindowOpen(
        {
          items: [{ fulfillmentType: "pickup" }],
          pickupSellerConfirmedAt: "2026-09-01T00:00:00.000Z",
          pickupBuyerConfirmedAt: "2026-09-03T00:00:00.000Z",
        },
        10,
        new Date("2026-09-20T00:00:00.000Z")
      )
    ).toBe(false);
  });

  it("points the buyer to physical receipt vs refund completion", () => {
    expect(storeReturnBuyerLabel("received")).toBe("Seller received your return. Refund is being processed.");
    expect(storeReturnBuyerLabel("refunded")).toMatch(/Refund Initiated/);
    expect(storeReturnBuyerLabel("awaiting_return")).toBe(
      "Return approved. A return label will appear on this order when the seller sends it."
    );
    expect(storeReturnBuyerLabel("awaiting_return", { hasReturnLabel: true })).toBe(
      "Your return has been approved. Print your return label now."
    );
  });

  it("allows a return label only for mail orders without one yet", () => {
    expect(orderCanBuyReturnLabel({ items: [{ fulfillmentType: "ship" }] })).toBe(true);
    expect(orderCanBuyReturnLabel({ items: [{ fulfillmentType: "pickup" }] })).toBe(false);
    expect(
      orderCanBuyReturnLabel({
        items: [{ fulfillmentType: "ship" }],
        returnShipment: { labelUrl: "https://example.com/label.pdf" },
      })
    ).toBe(false);
  });

  it("clamps return-day settings", () => {
    expect(clampAcceptReturnsDays(undefined)).toBe(30);
    expect(clampAcceptReturnsDays(0)).toBe(1);
    expect(clampAcceptReturnsDays(400)).toBe(365);
  });
});

describe("storeReturnSellerMoneyAction", () => {
  it("shows Mark received & refund while goods are still inbound", () => {
    expect(
      storeReturnSellerMoneyAction({ returnStatus: "awaiting_return", orderStatus: "shipped" })
    ).toBe("receive");
    expect(
      storeReturnSellerMoneyAction({ returnStatus: "in_transit", orderStatus: "delivered" })
    ).toBe("receive");
    expect(storeReturnSellerMoneyActionLabel("receive")).toBe(STORE_RETURN_RECEIVE_ACTION_LABEL);
  });

  it("shows Retry refund after physical receipt while the order is not refunded", () => {
    expect(
      storeReturnSellerMoneyAction({ returnStatus: "received", orderStatus: "delivered" })
    ).toBe("retry_refund");
    expect(storeReturnSellerMoneyActionLabel("retry_refund")).toBe(STORE_RETURN_RETRY_REFUND_ACTION_LABEL);
  });

  it("hides money actions once the order or return is refunded", () => {
    expect(
      storeReturnSellerMoneyAction({ returnStatus: "received", orderStatus: "refunded" })
    ).toBeNull();
    expect(
      storeReturnSellerMoneyAction({ returnStatus: "refunded", orderStatus: "refunded" })
    ).toBeNull();
    expect(
      storeReturnSellerMoneyAction({ returnStatus: "refunded", orderStatus: "delivered" })
    ).toBeNull();
  });

  it("hides money actions for requested, declined, and canceled", () => {
    expect(storeReturnSellerMoneyAction({ returnStatus: "requested", orderStatus: "shipped" })).toBeNull();
    expect(storeReturnSellerMoneyAction({ returnStatus: "declined", orderStatus: "shipped" })).toBeNull();
    expect(storeReturnSellerMoneyAction({ returnStatus: "canceled", orderStatus: "shipped" })).toBeNull();
  });
});
