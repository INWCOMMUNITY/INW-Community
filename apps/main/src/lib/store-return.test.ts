import { describe, expect, it } from "vitest";
import {
  buyerCanRequestRefund,
  clampAcceptReturnsDays,
  isActiveStoreReturnStatus,
  isAwaitingReturnStatus,
  isReturnWindowOpen,
  orderCanBuyReturnLabel,
  returnRefundAmountCents,
  returnWindowEndsAt,
  sellerTransferReversalCents,
  storeReturnBuyerLabel,
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
});

describe("return status", () => {
  it("treats requested and awaiting as active", () => {
    expect(isActiveStoreReturnStatus("requested")).toBe(true);
    expect(isActiveStoreReturnStatus("awaiting_return")).toBe(true);
    expect(isActiveStoreReturnStatus("declined")).toBe(false);
    expect(isAwaitingReturnStatus("awaiting_return")).toBe(true);
    expect(isAwaitingReturnStatus("requested")).toBe(false);
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

  it("points the buyer to print the label once it exists", () => {
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
