import { describe, expect, it } from "vitest";
import {
  buyerRefundStatusNote,
  storeOrderRefundPhase,
  storeOrderRefundStatusLabel,
  timestampsFromStripeRefund,
} from "./store-order-refund-status";

describe("storeOrderRefundPhase", () => {
  it("is initiated for a card refund that Stripe has not marked succeeded", () => {
    expect(storeOrderRefundPhase({ status: "refunded", isCashOrder: false })).toBe("initiated");
    expect(storeOrderRefundStatusLabel({ status: "refunded" })).toBe("Refund initiated");
  });

  it("is complete once refundCompletedAt is set", () => {
    expect(
      storeOrderRefundPhase({
        status: "refunded",
        refundCompletedAt: "2026-09-06T12:00:00.000Z",
      })
    ).toBe("complete");
    expect(
      storeOrderRefundStatusLabel({
        status: "refunded",
        refundCompletedAt: "2026-09-06T12:00:00.000Z",
      })
    ).toBe("Refund complete");
  });

  it("does not treat cash cancels as refunds", () => {
    expect(storeOrderRefundPhase({ status: "canceled", isCashOrder: true })).toBeNull();
  });
});

describe("buyerRefundStatusNote", () => {
  it("explains bank timing for both phases", () => {
    expect(buyerRefundStatusNote({ status: "refunded" })).toMatch(/5–10 business days/);
    expect(
      buyerRefundStatusNote({
        status: "refunded",
        refundCompletedAt: "2026-09-06T12:00:00.000Z",
      })
    ).toMatch(/Refund complete/);
  });
});

describe("timestampsFromStripeRefund", () => {
  it("marks complete only when Stripe status is succeeded", () => {
    expect(timestampsFromStripeRefund({ id: "re_1", status: "pending", created: 1 }).refundCompletedAt).toBeNull();
    expect(timestampsFromStripeRefund({ id: "re_1", status: "succeeded", created: 1 }).refundCompletedAt).toBeInstanceOf(
      Date
    );
  });
});
