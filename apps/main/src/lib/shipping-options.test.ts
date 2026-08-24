import { describe, expect, it } from "vitest";
import { listingPackageFromRemote, mergeImportedShippingOption } from "./shipping-options";

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
      }
    );
    expect(merged.name).toBe("Ground < 1 lb");
    expect(merged.lengthIn).toBe(10);
    expect(merged.widthIn).toBe(8);
    expect(merged.heightIn).toBe(4);
    expect(merged.weightOz).toBe(14);
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
});
