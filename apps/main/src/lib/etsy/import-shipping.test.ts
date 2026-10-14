import { describe, expect, it } from "vitest";
import {
  etsyListingPackageFromRaw,
  formatShippingCents,
  parseSellerShippingDollars,
} from "./import-shipping";

describe("etsy listing shipping import", () => {
  it("converts centimeter dimensions and pound weight", () => {
    expect(
      etsyListingPackageFromRaw({
        item_length: 25.4,
        item_width: "12.7",
        item_height: 5.08,
        item_dimensions_unit: "cm",
        item_weight: 1,
        item_weight_unit: "lb",
      })
    ).toEqual({
      lengthIn: 10,
      widthIn: 5,
      heightIn: 2,
      weightOz: 16,
    });
  });

  it("parses a seller-typed shipping price into cents", () => {
    expect(parseSellerShippingDollars("12.50")).toBe(1250);
    expect(parseSellerShippingDollars("$0")).toBe(0);
    expect(parseSellerShippingDollars("")).toBeNull();
    expect(parseSellerShippingDollars("12.999")).toBeNull();
    expect(parseSellerShippingDollars("-1")).toBeNull();
    expect(formatShippingCents(1250)).toBe("12.50");
  });
});
