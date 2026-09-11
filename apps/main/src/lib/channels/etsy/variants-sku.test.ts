import { describe, expect, it } from "vitest";
import { extractImportSkuFromEtsyProducts, etsyOfferingPriceCentsForOption } from "./variants";
import type { SyncStoreItem } from "../types";

const sizeItem = (priceCents: number, skuPrices: [number, number]): SyncStoreItem => ({
  id: "item-1",
  sku: "HAT",
  title: "Hat",
  description: null,
  photos: [],
  priceCents,
  quantity: 3,
  variants: {
    axes: [{ name: "Size", values: ["S", "M"] }],
    skus: [
      { options: { Size: "S" }, quantity: 1, priceCents: skuPrices[0] },
      { options: { Size: "M" }, quantity: 2, priceCents: skuPrices[1] },
    ],
  },
  status: "active",
  condition: "new",
  shippingCostCents: null,
  category: null,
  subcategory: null,
  secondaryCategory: null,
  etsyWhoMade: null,
  etsyWhenMade: null,
  etsyIsSupply: null,
  etsyTaxonomyId: null,
  ebayCategoryId: null,
  ebayConditionEnum: null,
  aspects: null,
});

describe("extractImportSkuFromEtsyProducts", () => {
  it("returns null when no products or SKUs", () => {
    expect(extractImportSkuFromEtsyProducts(undefined)).toBeNull();
    expect(extractImportSkuFromEtsyProducts([])).toBeNull();
    expect(extractImportSkuFromEtsyProducts([{ sku: "" }])).toBeNull();
  });

  it("returns full SKU for a simple single-product listing", () => {
    expect(extractImportSkuFromEtsyProducts([{ sku: "HAT-001" }])).toBe("HAT-001");
  });

  it("extracts shared base prefix for variant listings", () => {
    expect(
      extractImportSkuFromEtsyProducts([
        { sku: "MYSKU-blue" },
        { sku: "MYSKU-gray" },
        { sku: "MYSKU-black" },
      ])
    ).toBe("MYSKU");
  });

  it("falls back to first SKU when variants have no common prefix", () => {
    expect(
      extractImportSkuFromEtsyProducts([{ sku: "SKU-A" }, { sku: "OTHER-B" }])
    ).toBe("SKU-A");
  });
});

describe("etsyOfferingPriceCentsForOption", () => {
  it("uses the matching SKU price instead of the listing price", () => {
    const item = sizeItem(2000, [1800, 2500]);
    expect(etsyOfferingPriceCentsForOption(item, "S")).toBe(1800);
    expect(etsyOfferingPriceCentsForOption(item, "M")).toBe(2500);
  });

  it("falls back to listing price when the SKU has no price", () => {
    expect(etsyOfferingPriceCentsForOption(sizeItem(2000, [0, 0]), "S")).toBe(2000);
  });
});
