import { describe, expect, it } from "vitest";
import {
  listingPackageFromRemote,
  mergeImportedShippingOption,
  parseShippingCostCentsInput,
  importedListingShippingPatch,
} from "./shipping-options";

describe("mergeImportedShippingOption", () => {
  it("fills empty package fields from the remote and keeps existing measurements", () => {
    const merged = mergeImportedShippingOption(
      { name: "Old name", lengthIn: 10, widthIn: null, heightIn: 4, weightOz: 0 },
      {
        source: "etsy",
        remoteProfileId: "1",
        name: "Ground < 1 lb",
        lengthIn: 12,
        widthIn: 8,
        heightIn: 6,
        weightOz: 14,
        shippingCostCents: 599,
      }
    );
    expect(merged.name).toBe("Ground < 1 lb");
    expect(merged.lengthIn).toBe(10);
    expect(merged.widthIn).toBe(8);
    expect(merged.heightIn).toBe(4);
    expect(merged.weightOz).toBe(14);
    expect(merged.shippingCostCents).toBe(599);
  });

  it("keeps an existing shipping price including free (0) and ignores empty remote", () => {
    const keepFree = mergeImportedShippingOption(
      { name: "Keep", shippingCostCents: 0 },
      { source: "ebay", remoteProfileId: "p", name: "Ground", shippingCostCents: 799 }
    );
    expect(keepFree.shippingCostCents).toBe(0);

    const ignoreEmpty = mergeImportedShippingOption(
      { name: "Keep", shippingCostCents: 499 },
      { source: "ebay", remoteProfileId: "p", name: "Ground", shippingCostCents: null }
    );
    expect(ignoreEmpty.shippingCostCents).toBe(499);
  });
});

describe("listingPackageFromRemote", () => {
  it("converts Etsy listing weight/dims into ounces and inches", () => {
    const hint = listingPackageFromRemote({
      remoteProfileId: 99,
      weight: "1",
      weightUnit: "lb",
      length: "25.4",
      width: "10",
      height: "5",
      dimensionUnit: "cm",
    });
    expect(hint.remoteProfileId).toBe("99");
    expect(hint.weightOz).toBe(16);
    expect(hint.lengthIn).toBe(10);
    expect(hint.widthIn).toBeCloseTo(3.937, 2);
  });

  it("treats eBay OUNCE/INCH units as ounces and inches", () => {
    const hint = listingPackageFromRemote({
      remoteProfileId: "pol-1",
      weight: 24,
      weightUnit: "OUNCE",
      length: 10,
      width: 8,
      height: 6,
      dimensionUnit: "INCH",
    });
    expect(hint.weightOz).toBe(24);
    expect(hint.lengthIn).toBe(10);
  });
});

describe("parseShippingCostCentsInput", () => {
  it("parses dollars and requires a price when asked", () => {
    expect(parseShippingCostCentsInput({ shippingCostDollars: "5.99" })).toBe(599);
    expect(parseShippingCostCentsInput({ shippingCostCents: 0 })).toBe(0);
    expect(() => parseShippingCostCentsInput({ required: true })).toThrow(/required/i);
  });
});

describe("importedListingShippingPatch", () => {
  it("uses the listing's synced option and price", () => {
    expect(
      importedListingShippingPatch({
        importOptionsEnabled: true,
        offerFreeShippingOnInw: false,
        matchedOption: { id: "opt-1", shippingCostCents: 400 },
      })
    ).toEqual({ shippingOptionId: "opt-1", shippingCostCents: 400 });
  });

  it("keeps the option but charges $0 when INW free shipping is on", () => {
    expect(
      importedListingShippingPatch({
        importOptionsEnabled: true,
        offerFreeShippingOnInw: true,
        matchedOption: { id: "opt-1", shippingCostCents: 400 },
      })
    ).toEqual({ shippingOptionId: "opt-1", shippingCostCents: 0 });
  });

  it("does not attach a marketplace option when the seller did not sync them", () => {
    expect(
      importedListingShippingPatch({
        importOptionsEnabled: false,
        offerFreeShippingOnInw: false,
        matchedOption: { id: "opt-1", shippingCostCents: 400 },
      })
    ).toBeNull();
  });

  it("still applies free INW shipping when marketplace options are not synced", () => {
    expect(
      importedListingShippingPatch({
        importOptionsEnabled: false,
        offerFreeShippingOnInw: true,
      })
    ).toEqual({ shippingCostCents: 0 });
  });

  it("leaves an INW-created package in place", () => {
    expect(
      importedListingShippingPatch({
        importOptionsEnabled: true,
        offerFreeShippingOnInw: false,
        existingOptionSource: "inw",
        matchedOption: { id: "ebay-opt", shippingCostCents: 400 },
      })
    ).toBeNull();
  });
});
