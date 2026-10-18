import { describe, expect, it } from "vitest";
import { freeShippingBannerForStore, itemHasFreeShipping } from "./free-shipping-banner";

describe("freeShippingBannerForStore", () => {
  it("treats $0 as free shipping, and a missing or paid price as not free", () => {
    expect(itemHasFreeShipping({ shippingCostCents: 0 })).toBe(true);
    expect(itemHasFreeShipping({ shippingCostCents: null })).toBe(false);
    expect(itemHasFreeShipping({ shippingCostCents: 500 })).toBe(false);
    expect(itemHasFreeShipping({ shippingDisabled: true, shippingCostCents: 0 })).toBe(false);
  });

  it("shows the purchase-amount line when a minimum is set, even if an item charges shipping", () => {
    expect(
      freeShippingBannerForStore({
        freeShippingMinimumCents: 3500,
        items: [{ shippingCostCents: 0 }, { shippingCostCents: 500 }],
      })
    ).toBe("threshold");
  });

  it("shows the storewide line when every item ships free and no minimum is set", () => {
    expect(
      freeShippingBannerForStore({
        freeShippingMinimumCents: null,
        items: [{ shippingCostCents: 0 }, { shippingCostCents: 0 }],
      })
    ).toBe("storewide");
  });

  it("hides the banner when a shipping price was never set and no minimum is saved", () => {
    expect(
      freeShippingBannerForStore({
        freeShippingMinimumCents: null,
        items: [{ shippingCostCents: 0 }, { shippingCostCents: null }],
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

  it("hides the purchase-amount line when free shipping on INW is on", () => {
    expect(
      freeShippingBannerForStore({
        freeShippingMinimumCents: 3500,
        offerFreeShippingOnInw: true,
        items: [{ shippingCostCents: 500 }],
      })
    ).toBeNull();
  });

  it("shows the purchase-amount line when a minimum is set and the store has no items yet", () => {
    expect(
      freeShippingBannerForStore({
        freeShippingMinimumCents: 3500,
        items: [],
      })
    ).toBe("threshold");
  });
});
