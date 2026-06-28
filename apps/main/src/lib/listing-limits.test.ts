import { describe, expect, it } from "vitest";
import {
  EBAY_ASPECT_NAME_MAX,
  EBAY_ASPECT_VALUE_MAX,
  EBAY_TITLE_MAX,
  MAX_ASPECTS,
  aspectsToEbayProductAspects,
  clampListingTitle,
  normalizeListingAspects,
} from "./listing-limits";

describe("clampListingTitle", () => {
  it("truncates titles to the eBay cap", () => {
    const long = "x".repeat(120);
    expect(clampListingTitle(long)).toHaveLength(EBAY_TITLE_MAX);
  });
  it("leaves short titles untouched", () => {
    expect(clampListingTitle("Nike shoes")).toBe("Nike shoes");
  });
});

describe("normalizeListingAspects", () => {
  it("drops empty name or value rows and trims", () => {
    const out = normalizeListingAspects([
      { name: " Brand ", value: " Nike " },
      { name: "", value: "x" },
      { name: "Color", value: "" },
    ]);
    expect(out).toEqual([{ name: "Brand", value: "Nike" }]);
  });

  it("truncates name/value to eBay caps", () => {
    const out = normalizeListingAspects([
      { name: "n".repeat(60), value: "v".repeat(80) },
    ]);
    expect(out[0].name).toHaveLength(EBAY_ASPECT_NAME_MAX);
    expect(out[0].value).toHaveLength(EBAY_ASPECT_VALUE_MAX);
  });

  it("de-dupes identical name/value pairs case-insensitively", () => {
    const out = normalizeListingAspects([
      { name: "Brand", value: "Nike" },
      { name: "brand", value: "nike" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps multiple values for the same descriptor", () => {
    const out = normalizeListingAspects([
      { name: "Color", value: "Red" },
      { name: "Color", value: "Blue" },
    ]);
    expect(out).toHaveLength(2);
  });

  it("caps the number of rows at MAX_ASPECTS", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ name: `N${i}`, value: `V${i}` }));
    expect(normalizeListingAspects(many)).toHaveLength(MAX_ASPECTS);
  });

  it("returns an empty array for non-array input", () => {
    expect(normalizeListingAspects(null)).toEqual([]);
    expect(normalizeListingAspects(undefined)).toEqual([]);
    expect(normalizeListingAspects("nope")).toEqual([]);
  });
});

describe("aspectsToEbayProductAspects", () => {
  it("groups values by descriptor into eBay's array shape", () => {
    const grouped = aspectsToEbayProductAspects([
      { name: "Brand", value: "Nike" },
      { name: "Color", value: "Red" },
      { name: "Color", value: "Blue" },
    ]);
    expect(grouped).toEqual({ Brand: ["Nike"], Color: ["Red", "Blue"] });
  });

  it("does not duplicate identical values within a descriptor", () => {
    const grouped = aspectsToEbayProductAspects([
      { name: "Color", value: "Red" },
      { name: "Color", value: "Red" },
    ]);
    expect(grouped).toEqual({ Color: ["Red"] });
  });
});
