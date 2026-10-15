import { describe, expect, it } from "vitest";
import { freeShippingBannerForStore, itemHasFreeShipping } from "./free-shipping-banner";

describe("freeShippingBannerForStore", () => {
  it("treats $0 as free shipping, and a missing or paid price as not free", () => {
    expect(itemHasFreeShipping({ shippingCostCents: 0 })).toBe(true);
    expect(itemHasFreeShipping({ shippingCostCents: null })).toBe(false);
    expect(itemHasFreeShipping({ shippingCostCents: 500 })).toBe(false);
    expect(itemHasFreeShipping({ shippingDisabled: true, shippingCostCents: 0 })).toBe(false);
  });

  it("shows the purchase-amount line only when every item ships free and a minimum is set", () => {
    expect(
      freeShippingBannerForStore({
        freeShippingMinimumCents: 3500,
        items: [{ shippingCostCents: 0 }, { shippingCostCents: 0 }],
      })
    ).toBe("threshold");
  });

  it("hides the banner when a shipping price was never set, even if a minimum is saved", () => {
    expect(
      freeShippingBannerForStore({
        freeShippingMinimumCents: 3500,
        items: [{ shippingCostCents: 0 }, { shippingCostCents: null }],
      })
    ).toBeNull();
  });

  it("hides the banner when every item ships free but no minimum is set", () => {
    expect(
      freeShippingBannerForStore({
        freeShippingMinimumCents: null,
        items: [{ shippingCostCents: 0 }, { shippingCostCents: 0 }],
      })
    ).toBeNull();
  });

  it("hides the banner when any item charges shipping, even if a minimum is set", () => {
    expect(
      freeShippingBannerForStore({
        freeShippingMinimumCents: 3500,
        items: [{ shippingCostCents: 0 }, { shippingCostCents: 500 }],
      })
    ).toBeNull();
  });

  it("hides the banner when any item charges shipping and no minimum is set", () => {
    expect(
      freeShippingBannerForStore({
        freeShippingMinimumCents: null,
        items: [{ shippingCostCents: 0 }, { shippingCostCents: 500 }],
      })
    ).toBeNull();
  });

  it("hides the banner when the store has no items", () => {
    expect(
      freeShippingBannerForStore({
        freeShippingMinimumCents: 3500,
        items: [],
      })
    ).toBeNull();
  });
});
