import { describe, expect, it } from "vitest";
import {
  buyerCanRequestRefund,
  buyerCardRefundCents,
  buyerRefundBreakdown,
  buyerRefundCentsForFeeBearer,
  clampAcceptReturnsDays,
  isActiveStoreReturnStatus,
  isAwaitingReturnStatus,
  isReturnReceiveRefundRetryable,
  isReturnWindowOpen,
  nonRefundableStripeFeeCents,
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
  it("computes Stripe fee shortfall withheld from buyer refunds", () => {
    expect(nonRefundableStripeFeeCents({ totalCents: 1000, taxCents: 0 })).toBe(59);
    expect(buyerCardRefundCents({ totalCents: 1000, taxCents: 0 })).toBe(941);
    expect(buyerRefundCentsForFeeBearer({ totalCents: 1000, taxCents: 0 }, "buyer")).toBe(941);
    expect(buyerRefundCentsForFeeBearer({ totalCents: 1000, taxCents: 0 }, "seller")).toBe(1000);
    expect(nonRefundableStripeFeeCents({ totalCents: 10000, taxCents: 100 })).toBe(373);
    expect(buyerCardRefundCents({ totalCents: 10000, taxCents: 100 })).toBe(9727);
  });

  // charge 10100 → processing floor(10100*0.029)+30=323; tax product floor(10100*0.005)=50 → 9727
  it("deducts non-refundable Stripe fees when return shipping is not charged", () => {
    expect(
      returnRefundAmountCents({
        totalCents: 10000,
        taxCents: 100,
        chargeReturnShipping: false,
        returnLabelCostCents: 850,
      })
    ).toBe(9727);
  });

  it("deducts Stripe fees then the return label when chargeReturnShipping is on", () => {
    expect(
      returnRefundAmountCents({
        totalCents: 10000,
        taxCents: 100,
        chargeReturnShipping: true,
        returnLabelCostCents: 850,
      })
    ).toBe(8877);
  });

  it("shows the buyer each amount that makes up an expected return refund", () => {
    const breakdown = buyerRefundBreakdown({
      status: "shipped",
      totalCents: 10000,
      subtotalCents: 9000,
      shippingCostCents: 1000,
      taxCents: 100,
      returnLabelPayer: "buyer",
      storeReturn: {
        status: "awaiting_return",
        reason: "Changed my mind",
        chargeReturnShipping: true,
        returnLabelCostCents: 850,
      },
    });
    expect(breakdown?.title).toBe("Expected refund");
    expect(breakdown?.lines.map((line) => line.label)).toEqual([
      "Items",
      "Shipping",
      "Tax",
      "Card processing fee",
      "Sales tax fee",
      "Return label",
    ]);
    const net = (breakdown?.lines ?? []).reduce((sum, line) => {
      const cents = line.cents ?? 0;
      return sum + (line.kind === "deduction" ? -cents : cents);
    }, 0);
    const expected = returnRefundAmountCents({
      totalCents: 10000,
      taxCents: 100,
      chargeReturnShipping: true,
      returnLabelCostCents: 850,
    });
    expect(net).toBe(expected);
    expect(breakdown?.expectedCents).toBe(expected);
    expect(breakdown?.footnote).toBeNull();
  });

  it("leaves the return label off the total until the seller buys it", () => {
    const breakdown = buyerRefundBreakdown({
      status: "shipped",
      totalCents: 10000,
      subtotalCents: 10000,
      shippingCostCents: 0,
      taxCents: 100,
      returnLabelPayer: "buyer",
      storeReturn: {
        status: "requested",
        reason: "Changed my mind",
        chargeReturnShipping: true,
        returnLabelCostCents: 0,
      },
    });
    expect(breakdown?.lines.find((line) => line.label === "Return label")).toMatchObject({
      cents: null,
      detail: "Deducted when purchased",
    });
    expect(breakdown?.expectedCents).toBe(
      returnRefundAmountCents({
        totalCents: 10000,
        taxCents: 100,
        chargeReturnShipping: false,
      })
    );
    expect(breakdown?.footnote).toMatch(/deducted from this amount when the seller buys it/);
  });

  it("refunds the full charge when the seller cancels", () => {
    const breakdown = buyerRefundBreakdown({
      status: "canceled",
      totalCents: 10000,
      subtotalCents: 10000,
      taxCents: 100,
      cancelReason: "Seller canceled & refunded",
    });
    expect(breakdown?.expectedCents).toBe(10100);
    expect(breakdown?.lines.some((line) => line.kind === "deduction")).toBe(false);
  });

  it("hides the breakdown until a refund or return is underway", () => {
    expect(
      buyerRefundBreakdown({
        status: "shipped",
        totalCents: 10000,
        taxCents: 0,
      })
    ).toBeNull();
    expect(
      buyerRefundBreakdown({
        status: "shipped",
        isCashOrder: true,
        totalCents: 10000,
        storeReturn: { status: "requested", chargeReturnShipping: false },
      })
    ).toBeNull();
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
    expect(
      buyerCanRequestRefund(
        {
          status: "paid",
          isCashOrder: false,
          shipment: { createdAt: "2026-08-12T00:00:00.000Z" },
          sellerAcceptsReturnsDays: 30,
        },
        new Date("2026-08-20T00:00:00.000Z")
      )
    ).toBe(true);
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
  it("shows Mark Received & Refund while goods are still inbound", () => {
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
