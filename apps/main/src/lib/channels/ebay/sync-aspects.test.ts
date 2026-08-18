import { describe, expect, it } from "vitest";
import type { EbayCategoryAspect } from "./aspects";
import {
  inferGradedCoinAspectsFromTitle,
  mergeListingAspects,
  missingRequiredEbayAspects,
} from "./sync-aspects";
import { remapAspectsToTaxonomy } from "./ebay-compat";

const nickelTaxonomy: EbayCategoryAspect[] = [
  {
    name: "Professional grader",
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
    name: "Letter grade",
    required: true,
    mode: "FREE_TEXT",
    cardinality: "SINGLE",
    suggestedValues: [],
  },
];

describe("inferGradedCoinAspectsFromTitle", () => {
  it("infers grader, grade, and letter grade using taxonomy names", () => {
    const inferred = inferGradedCoinAspectsFromTitle(
      "1921 Morgan Dollar NGC MS 67",
      nickelTaxonomy
    );
    expect(inferred).toEqual(
      expect.arrayContaining([
        { name: "Professional grader", value: "NGC" },
        { name: "Grade", value: "MS 67" },
        { name: "Letter grade", value: "67" },
      ])
    );
  });

  it("returns empty when taxonomy has no grade fields", () => {
    const inferred = inferGradedCoinAspectsFromTitle("1921 Morgan Dollar NGC MS 67", []);
    expect(inferred).toEqual([]);
  });

  it("only adds letter grade when taxonomy has it (not numerical)", () => {
    const inferred = inferGradedCoinAspectsFromTitle(
      "1952-D NGC MS 67 Jefferson Nickel",
      nickelTaxonomy
    );
    expect(inferred.find((a) => a.name === "Letter grade")?.value).toBe("67");
    expect(inferred.find((a) => a.name === "Numerical grade")).toBeUndefined();
  });

  it("does not overwrite existing aspect values via merge", () => {
    const merged = mergeListingAspects(
      [{ name: "Letter grade", value: "66" }],
      inferGradedCoinAspectsFromTitle("NGC MS 67", nickelTaxonomy)
    );
    expect(merged.find((a) => a.name === "Letter grade")?.value).toBe("66");
  });
});

describe("missingRequiredEbayAspects", () => {
  it("treats empty values as missing", () => {
    const missing = missingRequiredEbayAspects(nickelTaxonomy, [
      { name: "Professional grader", value: "NGC" },
      { name: "Grade", value: "MS 67" },
      { name: "Letter grade", value: "   " },
    ]);
    expect(missing).toContain("Letter grade");
  });

  it("passes when all required specifics are filled", () => {
    const missing = missingRequiredEbayAspects(nickelTaxonomy, [
      { name: "Professional grader", value: "NGC" },
      { name: "Grade", value: "MS 67" },
      { name: "Letter grade", value: "67" },
    ]);
    expect(missing).toEqual([]);
  });
});

describe("remapAspectsToTaxonomy integration", () => {
  it("maps Certification to Professional grader for push", () => {
    const remapped = remapAspectsToTaxonomy(nickelTaxonomy, [
      { name: "Certification", value: "NGC" },
      { name: "Grade", value: "MS 67" },
      { name: "Letter grade", value: "67" },
    ]);
    expect(remapped.aspects.find((a) => a.name === "Professional grader")?.value).toBe("NGC");
  });
});
