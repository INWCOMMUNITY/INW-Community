import { describe, expect, it } from "vitest";
import {
  carryOuncesIntoPounds,
  carryOuncesIntoPoundsFields,
  combinePackages,
  convertLengthToIn,
  convertWeightToOz,
  formatShippingOptionPackageSummary,
  isPackageComplete,
  lbsOzToTotalOz,
  packageFingerprint,
  shippingOptionNeedsMeasurements,
  totalOzToLbsOz,
} from "./package-weight";

describe("lbs/oz conversion", () => {
  it("converts eBay-style lbs + oz to total ounces", () => {
    expect(lbsOzToTotalOz(1, 8)).toBe(24);
    expect(lbsOzToTotalOz(0, 4.5)).toBe(4.5);
  });

  it("splits total ounces back into whole lbs and remainder oz", () => {
    expect(totalOzToLbsOz(24)).toEqual({ lbs: 1, oz: 8 });
    expect(totalOzToLbsOz(4.5)).toEqual({ lbs: 0, oz: 4.5 });
    expect(totalOzToLbsOz(16)).toEqual({ lbs: 1, oz: 0 });
  });

  it("carries 16+ ounces into pounds", () => {
    expect(carryOuncesIntoPounds(0, 100)).toEqual({ lbs: 6, oz: 4 });
    expect(carryOuncesIntoPounds(2, 100)).toEqual({ lbs: 8, oz: 4 });
    expect(carryOuncesIntoPounds(1, 8)).toEqual({ lbs: 1, oz: 8 });
    expect(carryOuncesIntoPoundsFields("", "100")).toEqual({ weightLbs: "6", weightOz: "4" });
    expect(carryOuncesIntoPoundsFields("1", "8")).toEqual({ weightLbs: "1", weightOz: "8" });
  });
});

describe("unit conversion", () => {
  it("converts pounds and grams to ounces", () => {
    expect(convertWeightToOz(1, "lb")).toBe(16);
    expect(convertWeightToOz(16, "oz")).toBe(16);
    expect(convertWeightToOz(28.349523125, "g")).toBe(1);
  });

  it("converts cm to inches", () => {
    expect(convertLengthToIn(2.54, "cm")).toBe(1);
    expect(convertLengthToIn(12, "in")).toBe(12);
  });
});

describe("package completeness and combine", () => {
  it("requires all four measurements", () => {
    expect(isPackageComplete({ weightOz: 16, lengthIn: 12, widthIn: 8, heightIn: 4 })).toBe(true);
    expect(isPackageComplete({ weightOz: 16, lengthIn: 12, widthIn: 8, heightIn: null })).toBe(false);
  });

  it("does not require measurements on imported shipping options", () => {
    expect(shippingOptionNeedsMeasurements({ source: "etsy", complete: false })).toBe(false);
    expect(shippingOptionNeedsMeasurements({ source: "ebay", complete: false })).toBe(false);
    expect(shippingOptionNeedsMeasurements({ source: "inw", complete: false })).toBe(true);
    expect(
      formatShippingOptionPackageSummary({
        source: "etsy",
        complete: false,
        lengthIn: null,
        widthIn: null,
        heightIn: null,
        weightLbs: 0,
        weightOzRemainder: 0,
      })
    ).toBe("");
    expect(
      formatShippingOptionPackageSummary(
        {
          source: "etsy",
          complete: false,
          lengthIn: null,
          widthIn: null,
          heightIn: null,
          weightLbs: 0,
          weightOzRemainder: 0,
        },
        "Needs weight and size — Shippo and calculated Etsy will use defaults until you add measurements."
      )
    ).toBe("");
  });

  it("sums weight by quantity and takes max dimensions", () => {
    const combined = combinePackages([
      { weightOz: 8, lengthIn: 10, widthIn: 6, heightIn: 4, quantity: 2 },
      { weightOz: 4, lengthIn: 12, widthIn: 5, heightIn: 3, quantity: 1 },
    ]);
    expect(combined).toEqual({ weightOz: 20, lengthIn: 12, widthIn: 6, heightIn: 4 });
  });

  it("fingerprints rounded measurements", () => {
    expect(
      packageFingerprint({ weightOz: 16.04, lengthIn: 12.04, widthIn: 8, heightIn: 4 })
    ).toBe("16x12x8x4");
  });
});
