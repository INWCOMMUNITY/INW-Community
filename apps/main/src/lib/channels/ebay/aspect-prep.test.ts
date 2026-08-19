import { describe, expect, it } from "vitest";
import type { EbayCategoryAspect } from "./aspects";
import {
  enrichInventoryProductAspectsForPush,
  ensureGradedCoinInventoryAspects,
  filterSellerVisibleCategoryAspects,
  prepareAspectRowsForForm,
  prepareAspectsForEbayCategory,
  prepareLiveAspectsForInventoryPut,
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

/** Taxonomy without Letter grade — matches live 41087 API omitting it while Inventory still requires it. */
const taxonomyMissingLetterGrade: EbayCategoryAspect[] = nickelTaxonomy.filter(
  (a) => a.name !== "Letter grade"
);

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
    // Letter grade is eBay-only — not stored or shown to sellers
    expect(prep.remappedAspects.find((a) => a.name === "Letter grade")).toBeUndefined();
  });
});

describe("ensureGradedCoinInventoryAspects", () => {
  it("injects Letter grade for push when taxonomy omits it (41087-style)", () => {
    const trading = [
      { name: "Certification", value: "NGC" },
      { name: "Grade", value: "MS 67" },
      { name: "Year", value: "1952" },
    ];
    const ensured = ensureGradedCoinInventoryAspects(
      taxonomyMissingLetterGrade,
      trading,
      trading,
      "1952-D NGC MS 67 Jefferson Nickel"
    );
    expect(ensured.find((a) => a.name === "Letter grade")?.value).toBe("MS");
    expect(ensured.find((a) => a.name === "Numerical grade")?.value).toBe("67");
    expect(ensured.find((a) => a.name === "Professional grader")?.value).toBe("NGC");
  });
});

describe("filterSellerVisibleCategoryAspects", () => {
  it("hides Letter grade and Numerical grade from seller forms", () => {
    const visible = filterSellerVisibleCategoryAspects(nickelTaxonomy);
    expect(visible.some((a) => a.name === "Letter grade")).toBe(false);
    expect(visible.some((a) => a.name === "Grade")).toBe(true);
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
    expect(rows.some((a) => a.name === "Letter grade")).toBe(false);
  });
});

describe("enrichInventoryProductAspectsForPush", () => {
  it("keeps live aspects as base and snaps grader to taxonomy suggested value", () => {
    const taxonomy: EbayCategoryAspect[] = [
      {
        name: "Professional grader",
        required: true,
        mode: "SELECTION_ONLY",
        cardinality: "SINGLE",
        suggestedValues: ["NGC (Numismatic Guaranty Corporation)", "PCGS"],
      },
    ];
    const product = enrichInventoryProductAspectsForPush(
      { Grade: ["MS 67"], Year: ["1938"] },
      "1938 Jefferson Nickel NGC MS 67",
      taxonomy,
      { Certification: ["NGC"] }
    );
    expect(product["Professional grader"]).toEqual(["NGC (Numismatic Guaranty Corporation)"]);
    expect(product.Grade).toEqual(["MS 67"]);
    expect(product.Year).toEqual(["1938"]);
    expect(product["Letter grade"]).toEqual(["MS"]);
    expect(product["Numerical grade"]).toEqual(["67"]);
    expect(product.Certification).toBeUndefined();
  });
});

describe("prepareLiveAspectsForInventoryPut", () => {
  it("fixes live Letter grade=69 and drops it when taxonomy has Numerical grade only", () => {
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
    ];
    const product = prepareLiveAspectsForInventoryPut(
      {
        "Professional grader": ["NGC"],
        Grade: ["PR 69"],
        "Letter grade": ["69"],
        "Numerical grade": ["69"],
        Year: ["2002"],
      },
      "2002-S NGC PF 69 Ultra Cameo Roosevelt Dime",
      dimeTaxonomy
    );
    expect(product["Letter grade"]).toBeUndefined();
    expect(product["Numerical grade"]).toEqual(["69"]);
    expect(product["Professional grader"]).toEqual(["NGC"]);
  });

  it("preserveLiveWireGrades skips rewriting live wire grades on title-only PUT", () => {
    const live = {
      Certification: ["NGC"],
      "Professional grader": ["NGC"],
      Grade: ["MS 67"],
      "Letter grade": ["MS"],
      "Numerical grade": ["67"],
      Year: ["1938"],
    };
    const withPreserve = prepareLiveAspectsForInventoryPut(
      live,
      "1938 Jefferson Nickel NGC MS 67 Revised",
      nickelTaxonomy,
      { preserveLiveWireGrades: true }
    );
    expect(withPreserve["Letter grade"]).toEqual(["MS"]);
    expect(withPreserve["Numerical grade"]).toEqual(["67"]);
  });

  it("keeps Letter grade when taxonomy omits it but Inventory requires it (41087 nickel)", () => {
    const taxonomyMissingLetter: EbayCategoryAspect[] = nickelTaxonomy.filter(
      (a) => a.name !== "Letter grade"
    );
    const liveNickel = {
      Composition: ["Copper-Nickel"],
      Mint: ["Denver"],
      "Strike Type": ["Business"],
      Grade: ["MS 67"],
      "Modified Item": ["No"],
    };
    const product = prepareLiveAspectsForInventoryPut(
      liveNickel,
      "1938 Jefferson Nickel NGC MS 67",
      taxonomyMissingLetter,
      {},
      { Certification: ["NGC"] }
    );
    expect(product["Letter grade"]).toEqual(["MS"]);
    expect(product["Numerical grade"]).toEqual(["67"]);
    expect(product["Professional grader"]).toEqual(["NGC"]);
    expect(product.Certification).toBeUndefined();
  });
});
