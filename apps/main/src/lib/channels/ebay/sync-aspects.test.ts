import { describe, expect, it } from "vitest";
import type { EbayCategoryAspect } from "./aspects";
import {
  inferGradedCoinAspectsFromTitle,
  mergeListingAspects,
  missingRequiredEbayAspects,
} from "./sync-aspects";

const gradedCoinAspects: EbayCategoryAspect[] = [
  {
    name: "Professional Grader",
    required: true,
    mode: "SELECTION_ONLY",
    cardinality: "SINGLE",
    suggestedValues: ["NGC", "PCGS"],
  },
  {
    name: "Grade",
    required: true,
    mode: "FREE_TEXT",
    cardinality: "SINGLE",
    suggestedValues: [],
  },
  {
    name: "Numerical grade",
    required: true,
    mode: "FREE_TEXT",
    cardinality: "SINGLE",
    suggestedValues: [],
  },
  {
    name: "Certification Number",
    required: false,
    mode: "FREE_TEXT",
    cardinality: "SINGLE",
    suggestedValues: [],
  },
];

describe("inferGradedCoinAspectsFromTitle", () => {
  it("infers grader, grade label, and numerical grade from NGC MS title", () => {
    const inferred = inferGradedCoinAspectsFromTitle(
      "1921 Morgan Dollar NGC MS 67",
      gradedCoinAspects
    );
    expect(inferred).toEqual(
      expect.arrayContaining([
        { name: "Professional Grader", value: "NGC" },
        { name: "Grade", value: "MS 67" },
        { name: "Numerical grade", value: "67" },
      ])
    );
  });

  it("infers using standard eBay aspect names when taxonomy is unavailable", () => {
    const inferred = inferGradedCoinAspectsFromTitle("1921 Morgan Dollar NGC MS 67", []);
    expect(inferred).toEqual([
      { name: "Professional Grader", value: "NGC" },
      { name: "Grade", value: "MS 67" },
      { name: "Numerical grade", value: "67" },
    ]);
  });

  it("does not overwrite existing aspect values", () => {
    const merged = mergeListingAspects(
      [{ name: "Numerical grade", value: "66" }],
      inferGradedCoinAspectsFromTitle("NGC MS 67", gradedCoinAspects)
    );
    expect(merged.find((a) => a.name === "Numerical grade")?.value).toBe("66");
  });
});

describe("missingRequiredEbayAspects", () => {
  it("treats empty values as missing", () => {
    const missing = missingRequiredEbayAspects(gradedCoinAspects, [
      { name: "Professional Grader", value: "NGC" },
      { name: "Grade", value: "MS 67" },
      { name: "Numerical grade", value: "   " },
    ]);
    expect(missing).toContain("Numerical grade");
  });

  it("passes when all required specifics are filled", () => {
    const missing = missingRequiredEbayAspects(gradedCoinAspects, [
      { name: "Professional Grader", value: "NGC" },
      { name: "Grade", value: "MS 67" },
      { name: "Numerical grade", value: "67" },
    ]);
    expect(missing).toEqual([]);
  });
});
