import { describe, expect, it } from "vitest";
import type { EbayCategoryAspect } from "./aspects";
import {
  prepareAspectRowsForForm,
  prepareAspectsForEbayCategory,
} from "./aspect-prep";

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
  {
    name: "Year",
    required: true,
    mode: "FREE_TEXT",
    cardinality: "SINGLE",
    suggestedValues: [],
  },
];

describe("prepareAspectsForEbayCategory", () => {
  it("accepts Trading import names (Certification, Grade) as satisfying taxonomy requirements", () => {
    const prep = prepareAspectsForEbayCategory(
      nickelTaxonomy,
      [
        { name: "Certification", value: "NGC" },
        { name: "Grade", value: "MS 67" },
        { name: "Year", value: "1952" },
      ],
      "1952-D NGC MS 67 Jefferson Nickel"
    );
    expect(prep.valid).toBe(true);
    expect(prep.missingRequired).toEqual([]);
    expect(prep.remappedAspects.find((a) => a.name === "Professional grader")?.value).toBe("NGC");
    expect(prep.remappedAspects.find((a) => a.name === "Letter grade")?.value).toBe("67");
  });
});

describe("prepareAspectRowsForForm", () => {
  it("remaps Certification to Professional grader instead of seeding a duplicate empty row", () => {
    const rows = prepareAspectRowsForForm(
      nickelTaxonomy,
      [
        { name: "Certification", value: "NGC" },
        { name: "Grade", value: "MS 67" },
        { name: "Year", value: "1952" },
      ],
      "1952-D NGC MS 67 Jefferson Nickel"
    );
    expect(rows.some((a) => a.name === "Certification")).toBe(false);
    expect(rows.find((a) => a.name === "Professional grader")?.value).toBe("NGC");
    expect(rows.find((a) => a.name === "Professional grader")?.value).not.toBe("");
  });
});
