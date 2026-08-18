import { describe, expect, it } from "vitest";
import type { EbayCategoryAspect } from "./aspects";
import {
  backfillRequiredTaxonomyAspects,
  fillEmptyTaxonomyAspectsFromTitle,
  expandGradedCoinAspectsForTaxonomy,
  inventoryAspectsToListingAspects,
  mergeAspectSources,
  remapAspectsToTaxonomy,
  validateRemappedAspects,
} from "./ebay-compat";

/** Production-like taxonomy for Jefferson Nickel (41087) — note lowercase "grader". */
const nickelTaxonomy: EbayCategoryAspect[] = [
  {
    name: "Professional grader",
    required: true,
    mode: "SELECTION_ONLY",
    cardinality: "SINGLE",
    suggestedValues: ["NGC", "PCGS", "ANACS", "ICG"],
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
  {
    name: "Year",
    required: true,
    mode: "FREE_TEXT",
    cardinality: "SINGLE",
    suggestedValues: [],
  },
];

/** Roosevelt Dime (39458) uses Numerical grade instead of Letter grade. */
const dimeTaxonomy: EbayCategoryAspect[] = [
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
    name: "Numerical grade",
    required: true,
    mode: "FREE_TEXT",
    cardinality: "SINGLE",
    suggestedValues: [],
  },
  {
    name: "Year",
    required: true,
    mode: "FREE_TEXT",
    cardinality: "SINGLE",
    suggestedValues: [],
  },
];

describe("remapAspectsToTaxonomy", () => {
  it("maps Trading Certification to taxonomy Professional grader", () => {
    const result = remapAspectsToTaxonomy(nickelTaxonomy, [
      { name: "Certification", value: "NGC" },
      { name: "Grade", value: "MS 67" },
      { name: "Year", value: "1952" },
    ]);
    expect(result.aspects).toEqual(
      expect.arrayContaining([
        { name: "Professional grader", value: "NGC" },
        { name: "Grade", value: "MS 67" },
        { name: "Year", value: "1952" },
      ])
    );
    expect(result.aspects.find((a) => a.name === "Certification")).toBeUndefined();
  });

  it("fixes wrong-cased Professional Grader to taxonomy Professional grader", () => {
    const result = remapAspectsToTaxonomy(nickelTaxonomy, [
      { name: "Professional Grader", value: "NGC" },
      { name: "Grade", value: "MS 67" },
      { name: "Letter grade", value: "67" },
      { name: "Year", value: "1952" },
    ]);
    expect(result.aspects.find((a) => a.name === "Professional grader")?.value).toBe("NGC");
    expect(result.aspects.find((a) => a.name === "Professional Grader")).toBeUndefined();
  });

  it("drops aspects not in taxonomy", () => {
    const result = remapAspectsToTaxonomy(nickelTaxonomy, [
      { name: "Random Field", value: "foo" },
      { name: "Year", value: "1952" },
    ]);
    expect(result.dropped).toContain("Random Field");
    expect(result.aspects).toEqual([{ name: "Year", value: "1952" }]);
  });

  it("normalizes SELECTION_ONLY values case-insensitively", () => {
    const result = remapAspectsToTaxonomy(nickelTaxonomy, [
      { name: "Certification", value: "ngc" },
      { name: "Grade", value: "MS 67" },
      { name: "Letter grade", value: "67" },
      { name: "Year", value: "1952" },
    ]);
    expect(result.aspects.find((a) => a.name === "Professional grader")?.value).toBe("NGC");
    expect(result.valueAdjustments.some((a) => a.from === "ngc" && a.to === "NGC")).toBe(true);
  });

  it("maps synonym aliases when taxonomy uses the alias name not the canonical key", () => {
    const taxonomy: EbayCategoryAspect[] = [
      ...nickelTaxonomy,
      {
        name: "Country of Origin",
        required: false,
        mode: "FREE_TEXT",
        cardinality: "SINGLE",
        suggestedValues: [],
      },
      {
        name: "Mint Location",
        required: false,
        mode: "FREE_TEXT",
        cardinality: "SINGLE",
        suggestedValues: [],
      },
    ];
    const result = remapAspectsToTaxonomy(taxonomy, [
      { name: "Country", value: "United States" },
      { name: "Mint", value: "Philadelphia" },
    ]);
    expect(result.dropped).toEqual([]);
    expect(result.aspects.find((a) => a.name === "Country of Origin")?.value).toBe("United States");
    expect(result.aspects.find((a) => a.name === "Mint Location")?.value).toBe("Philadelphia");
  });
});

describe("mergeAspectSources", () => {
  it("preserves inventory keys and overlays INW values", () => {
    const merged = mergeAspectSources(
      [
        { name: "Professional grader", value: "NGC" },
        { name: "Letter grade", value: "67" },
      ],
      [{ name: "Grade", value: "MS 67" }, { name: "Year", value: "1952" }]
    );
    expect(merged).toEqual(
      expect.arrayContaining([
        { name: "Professional grader", value: "NGC" },
        { name: "Letter grade", value: "67" },
        { name: "Grade", value: "MS 67" },
        { name: "Year", value: "1952" },
      ])
    );
  });
});

describe("inventoryAspectsToListingAspects", () => {
  it("converts Inventory API aspect object", () => {
    const rows = inventoryAspectsToListingAspects({
      "Professional grader": ["NGC"],
      Grade: ["MS 67"],
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        { name: "Professional grader", value: "NGC" },
        { name: "Grade", value: "MS 67" },
      ])
    );
  });
});

describe("fillEmptyTaxonomyAspectsFromTitle", () => {
  it("only fills taxonomy fields that exist for the category", () => {
    const filled = fillEmptyTaxonomyAspectsFromTitle(
      "1952-D NGC MS 67 Jefferson Nickel",
      nickelTaxonomy,
      [{ name: "Year", value: "1952" }]
    );
    expect(filled.find((a) => a.name === "Professional grader")?.value).toBe("NGC");
    expect(filled.find((a) => a.name === "Grade")?.value).toBe("MS 67");
    expect(filled.find((a) => a.name === "Letter grade")?.value).toBe("67");
    expect(filled.find((a) => a.name === "Numerical grade")).toBeUndefined();
  });

  it("adds Numerical grade for dime taxonomy not Letter grade", () => {
    const filled = fillEmptyTaxonomyAspectsFromTitle(
      "2002-S NGC PF 69 Ultra Cameo Roosevelt Dime",
      dimeTaxonomy,
      [{ name: "Year", value: "2002" }]
    );
    expect(filled.find((a) => a.name === "Numerical grade")?.value).toBe("69");
    expect(filled.find((a) => a.name === "Letter grade")).toBeUndefined();
  });

  it("does not overwrite existing values", () => {
    const filled = fillEmptyTaxonomyAspectsFromTitle("NGC MS 67", nickelTaxonomy, [
      { name: "Professional grader", value: "PCGS" },
    ]);
    expect(filled.find((a) => a.name === "Professional grader")?.value).toBe("PCGS");
  });

  it("infers Year from coin title when taxonomy requires it", () => {
    const filled = fillEmptyTaxonomyAspectsFromTitle(
      "1952-D NGC MS 67 Jefferson Nickel",
      nickelTaxonomy,
      [{ name: "Professional grader", value: "NGC" }]
    );
    expect(filled.find((a) => a.name === "Year")?.value).toBe("1952");
  });
});

describe("expandGradedCoinAspectsForTaxonomy", () => {
  it("derives Letter grade and Professional grader from Trading Grade + Certification", () => {
    const expanded = expandGradedCoinAspectsForTaxonomy(nickelTaxonomy, [
      { name: "Certification", value: "NGC" },
      { name: "Grade", value: "MS 67" },
      { name: "Year", value: "1952" },
    ]);
    const remapped = remapAspectsToTaxonomy(nickelTaxonomy, expanded);
    expect(remapped.aspects.find((a) => a.name === "Professional grader")?.value).toBe("NGC");
    expect(remapped.aspects.find((a) => a.name === "Letter grade")?.value).toBe("67");
    const validation = validateRemappedAspects(nickelTaxonomy, remapped.aspects);
    expect(validation.valid).toBe(true);
  });

  it("derives Numerical grade for dime taxonomy from Grade PR 69", () => {
    const expanded = expandGradedCoinAspectsForTaxonomy(dimeTaxonomy, [
      { name: "Certification", value: "NGC" },
      { name: "Grade", value: "PR 69" },
      { name: "Year", value: "2002" },
    ]);
    const remapped = remapAspectsToTaxonomy(dimeTaxonomy, expanded);
    expect(remapped.aspects.find((a) => a.name === "Professional grader")?.value).toBe("NGC");
    expect(remapped.aspects.find((a) => a.name === "Numerical grade")?.value).toBe("69");
    expect(remapped.aspects.find((a) => a.name === "Letter grade")).toBeUndefined();
  });
});

describe("backfillRequiredTaxonomyAspects", () => {
  it("restores Year from title when remap dropped it", () => {
    const sources = [
      { name: "Certification", value: "NGC" },
      { name: "Grade", value: "MS 67" },
    ];
    const remapped = remapAspectsToTaxonomy(nickelTaxonomy, sources).aspects;
    const backfilled = backfillRequiredTaxonomyAspects(
      nickelTaxonomy,
      remapped,
      sources,
      "1952-D NGC MS 67 Jefferson Nickel"
    );
    expect(backfilled.find((a) => a.name === "Year")?.value).toBe("1952");
    const validation = validateRemappedAspects(nickelTaxonomy, backfilled);
    expect(validation.missingRequired).not.toContain("Year");
  });
});

describe("validateRemappedAspects", () => {
  it("passes when remapped coin aspects are complete", () => {
    const remapped = remapAspectsToTaxonomy(nickelTaxonomy, [
      { name: "Certification", value: "NGC" },
      { name: "Grade", value: "MS 67" },
      { name: "Letter grade", value: "67" },
      { name: "Year", value: "1952" },
    ]);
    const validation = validateRemappedAspects(nickelTaxonomy, remapped.aspects);
    expect(validation.valid).toBe(true);
    expect(validation.missingRequired).toEqual([]);
  });

  it("flags missing required after remap", () => {
    const remapped = remapAspectsToTaxonomy(nickelTaxonomy, [
      { name: "Certification", value: "NGC" },
    ]);
    const validation = validateRemappedAspects(nickelTaxonomy, remapped.aspects);
    expect(validation.missingRequired.length).toBeGreaterThan(0);
    expect(validation.missingRequired).toContain("Letter grade");
  });
});
