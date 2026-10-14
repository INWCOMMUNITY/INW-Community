import { describe, expect, it } from "vitest";
import {
  etsyListingPackageFromRaw,
  importedInwShippingCents,
  shouldAttachImportedEtsyPackage,
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

  it("imports the domestic price only when dimensions exist", () => {
    const packageDimensions = etsyListingPackageFromRaw({
      item_length: 8,
      item_width: 6,
      item_height: 4,
      item_dimensions_unit: "in",
    });
    expect(
      importedInwShippingCents({
        policy: "IMPORT_PRICES",
        packageDimensions,
        domesticShippingCents: 599,
      })
    ).toBe(599);
    expect(
      shouldAttachImportedEtsyPackage({
        policy: "IMPORT_PRICES",
        packageDimensions,
        domesticShippingCents: 599,
      })
    ).toBe(true);
    expect(
      importedInwShippingCents({
        policy: "IMPORT_PRICES",
        packageDimensions: null,
        domesticShippingCents: 599,
      })
    ).toBe(0);
  });

  it("ships free when that choice is selected", () => {
    expect(
      importedInwShippingCents({
        policy: "FREE",
        packageDimensions: {
          lengthIn: 8,
          widthIn: 6,
          heightIn: 4,
          weightOz: 8,
        },
        domesticShippingCents: 599,
      })
    ).toBe(0);
  });
});
