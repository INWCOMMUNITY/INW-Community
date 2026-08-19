import { describe, expect, it } from "vitest";
import { formatListingFeeSummary, getListingFeeBlockReason } from "./fees";

describe("formatListingFeeSummary", () => {
  it("formats the first fee row", () => {
    expect(
      formatListingFeeSummary([
        { feeSummary: { totalFeeAmount: { value: "0.35", currency: "USD" } } },
      ])
    ).toBe("Estimated listing fee: USD 0.35");
  });

  it("returns null when no amount is present", () => {
    expect(formatListingFeeSummary([{}])).toBeNull();
  });
});

describe("getListingFeeBlockReason", () => {
  it("returns a seller-readable reason when fee errors exist", () => {
    const reason = getListingFeeBlockReason([
      { errors: [{ errorId: 25002, message: "Offer is missing a category." }] },
    ]);
    expect(reason).toContain("25002");
  });

  it("returns null when there are no fee errors", () => {
    expect(getListingFeeBlockReason([{ feeSummary: { totalFeeAmount: { value: "0.35" } } }])).toBeNull();
  });
});
