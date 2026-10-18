import { describe, expect, it } from "vitest";
import {
  readReturnRefundTiming,
  returnLabelIsDue,
  sellerMustChooseReturnRefundTiming,
  withReturnRefundTiming,
} from "./return-refund-timing";

describe("return refund timing", () => {
  it("keeps a local-delivery note when saving the choice", () => {
    const next = withReturnRefundTiming({ note: "leave at door" }, "on_arrival");
    expect(next.note).toBe("leave at door");
    expect(readReturnRefundTiming(next)).toBe("on_arrival");
  });

  it("marks the label due until a PDF exists", () => {
    const open = { status: "shipped", storeReturn: { status: "awaiting_return" } };
    expect(returnLabelIsDue(open)).toBe(true);
    expect(returnLabelIsDue({ ...open, returnShipment: { labelUrl: "https://example.com/l.pdf" } })).toBe(false);
  });

  it("requires a choice only after the label is sent", () => {
    const labeled = {
      status: "shipped",
      storeReturn: { status: "in_transit" },
      returnShipment: { labelUrl: "https://example.com/l.pdf" },
    };
    expect(sellerMustChooseReturnRefundTiming(labeled)).toBe(true);
    expect(
      sellerMustChooseReturnRefundTiming({
        ...labeled,
        localDeliveryDetails: withReturnRefundTiming(null, "on_arrival"),
      })
    ).toBe(false);
    expect(sellerMustChooseReturnRefundTiming({ ...labeled, status: "refunded" })).toBe(false);
  });
});
