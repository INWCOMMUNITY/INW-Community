import { describe, expect, it } from "vitest";
import { buyerCommerceStatus } from "./buyer-commerce-status";

describe("buyerCommerceStatus", () => {
  it("shows a short return-requested banner", () => {
    expect(
      buyerCommerceStatus({ status: "shipped", storeReturn: { status: "requested" } })
    ).toMatchObject({
      title: "Return requested",
      detail: "The seller will review.",
      tone: "pending",
    });
  });

  it("says a label is on the way until one exists", () => {
    expect(
      buyerCommerceStatus({ status: "shipped", storeReturn: { status: "awaiting_return" } })
    ).toMatchObject({ title: "Return approved", detail: "A return label is on the way." });
    expect(
      buyerCommerceStatus({
        status: "shipped",
        storeReturn: { status: "awaiting_return" },
        returnShipment: { labelUrl: "https://example.com/label.pdf" },
      })
    ).toMatchObject({ detail: "Print your return label." });
  });

  it("prefers the refund phase once money is moving", () => {
    expect(
      buyerCommerceStatus({
        status: "refunded",
        storeReturn: { status: "refunded" },
      })
    ).toMatchObject({ title: "Refund initiated", tone: "moving" });
    expect(
      buyerCommerceStatus({
        status: "refunded",
        refundCompletedAt: "2026-10-17T00:00:00.000Z",
      })?.title
    ).toBe("Refund complete");
  });

  it("keeps a declined reason", () => {
    expect(
      buyerCommerceStatus({
        status: "delivered",
        storeReturn: { status: "declined", declineReason: "Outside the return window." },
      })?.detail
    ).toBe("Outside the return window.");
  });
});
