import { describe, expect, it } from "vitest";
import { sellerOrderShippingCents, sellerOrderShippingQuote } from "./checkout-shipping-cost";

const lines = [
  { quantity: 1, fulfillmentType: "ship", shippingCostCents: 500 },
  { quantity: 2, fulfillmentType: "ship", shippingCostCents: 300 },
];

describe("sellerOrderShippingCents", () => {
  it("adds each shipped item's price times quantity when no rules are set", () => {
    expect(sellerOrderShippingCents({ lines, merchandiseCents: 4000 })).toBe(500 + 600);
  });

  it("caps a multi-item shipment at the combined maximum", () => {
    expect(
      sellerOrderShippingCents({
        lines,
        merchandiseCents: 4000,
        rules: {
          combineShipping: true,
          combinedShippingMaxCents: 800,
          freeShippingMinimumCents: null,
        },
      })
    ).toBe(800);
  });

  it("does not cap a single shipped item", () => {
    expect(
      sellerOrderShippingCents({
        lines: [{ quantity: 1, fulfillmentType: "ship", shippingCostCents: 1200 }],
        merchandiseCents: 2000,
        rules: {
          combineShipping: true,
          combinedShippingMaxCents: 800,
          freeShippingMinimumCents: null,
        },
      })
    ).toBe(1200);
  });

  it("ships free once the store merchandise total reaches the threshold", () => {
    expect(
      sellerOrderShippingCents({
        lines,
        merchandiseCents: 5000,
        rules: {
          combineShipping: true,
          combinedShippingMaxCents: 800,
          freeShippingMinimumCents: 5000,
        },
      })
    ).toBe(0);
  });

  it("caps one listing bought in quantity above one", () => {
    const quote = sellerOrderShippingQuote({
      lines: [{ quantity: 3, fulfillmentType: "ship", shippingCostCents: 500 }],
      merchandiseCents: 1500,
      rules: {
        combineShipping: true,
        combinedShippingMaxCents: 1250,
        freeShippingMinimumCents: 3500,
      },
    });
    expect(quote.cents).toBe(1250);
    expect(quote.combinedCapApplied).toBe(true);
  });

  it("does not mark the cap when the uncapped total is already under it", () => {
    expect(
      sellerOrderShippingQuote({
        lines: [{ quantity: 2, fulfillmentType: "ship", shippingCostCents: 400 }],
        merchandiseCents: 2000,
        rules: {
          combineShipping: true,
          combinedShippingMaxCents: 1250,
          freeShippingMinimumCents: null,
        },
      }).combinedCapApplied
    ).toBe(false);
  });
  it("ignores pickup lines", () => {
    expect(
      sellerOrderShippingCents({
        lines: [{ quantity: 1, fulfillmentType: "pickup", shippingCostCents: 500 }],
        merchandiseCents: 1000,
      })
    ).toBe(0);
  });
});
