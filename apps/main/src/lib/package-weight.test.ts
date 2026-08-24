import { describe, expect, it } from "vitest";
import {
  combinePackages,
  convertLengthToIn,
  convertWeightToOz,
  isPackageComplete,
  lbsOzToTotalOz,
  packageFingerprint,
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
