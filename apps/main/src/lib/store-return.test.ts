import { describe, expect, it } from "vitest";
import {
  buyerCanRequestRefund,
  isActiveStoreReturnStatus,
  isAwaitingReturnStatus,
  returnRefundAmountCents,
  sellerTransferReversalCents,
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
});
