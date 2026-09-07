import { describe, expect, it } from "vitest";
import {
  buyerRefundStatusNote,
  latestRefundFromCharge,
  orderNeedsRefundCompletionSync,
  storeOrderRefundPhase,
  storeOrderRefundStatusLabel,
  timestampsFromStripeRefund,
} from "./store-order-refund-status";

describe("storeOrderRefundPhase", () => {
  it("is initiated for a card refund that Stripe has not marked succeeded", () => {
    expect(storeOrderRefundPhase({ status: "refunded", isCashOrder: false })).toBe("initiated");
    expect(storeOrderRefundStatusLabel({ status: "refunded" })).toBe("Refund Initiated");
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
      }      )
    ).toBe("Refund Complete");
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
    ).toMatch(/Refund Complete/);
  });
});

describe("orderNeedsRefundCompletionSync", () => {
  it("asks Stripe for refunded orders that are not marked complete", () => {
    expect(
      orderNeedsRefundCompletionSync({
        status: "refunded",
        stripePaymentIntentId: "pi_1",
        refundCompletedAt: null,
      })
    ).toBe(true);
    expect(
      orderNeedsRefundCompletionSync({
        status: "refunded",
        stripePaymentIntentId: "pi_1",
        refundCompletedAt: "2026-09-06T12:00:00.000Z",
      })
    ).toBe(false);
  });
});

describe("latestRefundFromCharge", () => {
  it("prefers a succeeded refund on the charge", () => {
    expect(
      latestRefundFromCharge({
        refunds: {
          data: [
            { id: "re_pending", status: "pending", created: 2 },
            { id: "re_ok", status: "succeeded", created: 1 },
          ],
        },
      })?.id
    ).toBe("re_ok");
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
