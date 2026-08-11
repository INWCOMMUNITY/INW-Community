import { describe, expect, it } from "vitest";
import { extractImportSkuFromEtsyProducts } from "./variants";

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
