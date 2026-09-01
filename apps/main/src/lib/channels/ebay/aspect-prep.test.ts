import { describe, expect, it } from "vitest";
import type { EbayCategoryAspect } from "./aspects";
import {
  enrichInventoryProductAspectsForPush,
  ensureGradedCoinInventoryAspects,
  fillDefaultEbayAspects,
  missingOftenRequiredEbayAspects,
  filterSellerVisibleCategoryAspects,
  prepareAspectRowsForForm,
  prepareAspectsForEbayCategory,
  prepareLiveAspectsForInventoryPut,
  liveInventoryWireGradesCorrupted,
  passthroughUsePreparedInventoryAspects,
  ebayAspectRowsForListOnPopup,
  ebayAspectUsesDropdown,
  ebayListOnFallbackAspects,
  missingEbayAspectsForListOn,
  normalizeEbayBrandValue,
  restoreOftenRequiredSellerAspects,
  sellerVisibleBrandChoices,
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
      { Certification: ["NGC (Numismatic Guaranty Corporation)"] }
    );
    expect(product["Professional grader"]).toEqual(["NGC (Numismatic Guaranty Corporation)"]);
    expect(product.Grade).toBeUndefined();
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
        "Professional grader": ["NGC (Numismatic Guaranty Corporation)"],
        Grade: ["PR 69"],
        "Letter grade": ["69"],
        "Numerical grade": ["69"],
        Year: ["2002"],
      },
      "2002-S NGC PF 69 Ultra Cameo Roosevelt Dime",
      dimeTaxonomy,
      { categoryId: "39458" }
    );
    expect(product["Letter grade"]).toEqual(["69"]);
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
    expect(withPreserve["Professional grader"]).toEqual(["NGC"]);
    expect(withPreserve.Grade).toEqual(["MS 67"]);
  });

  it("snaps bare live Professional grader to full label when taxonomy is unavailable", () => {
    const live = {
      "Professional grader": ["NGC"],
      Grade: ["MS 67"],
      "Letter grade": ["MS"],
      "Numerical grade": ["67"],
    };
    const product = prepareLiveAspectsForInventoryPut(
      live,
      "1952-D NGC MS 67 Jefferson Nickel",
      [],
      { categoryId: "41087" }
    );
    expect(product["Professional grader"]).toEqual(["NGC"]);
    expect(product.Grade).toBeUndefined();
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
      { categoryId: "41087" },
      { Certification: ["NGC (Numismatic Guaranty Corporation)"] }
    );
    expect(product["Letter grade"]).toEqual(["MS"]);
    expect(product["Numerical grade"]).toEqual(["67"]);
    expect(product["Professional grader"]).toEqual(["NGC"]);
    expect(product.Certification).toBeUndefined();
  });

  it("snaps Professional grader to bare prefix when taxonomy is unavailable", () => {
    const product = prepareLiveAspectsForInventoryPut(
      { Composition: ["Clad"] },
      "2002-S NGC PF 69 Ultra Cameo Roosevelt Dime",
      [],
      { categoryId: "39458" },
      { Certification: ["NGC (Numismatic Guaranty Corporation)"], Grade: ["PR 69"] }
    );
    expect(product["Professional grader"]).toEqual(["NGC"]);
    expect(product["Letter grade"]).toEqual(["69"]);
  });

  it("keeps Letter grade for 41087 when taxonomy has Numerical grade but omits Letter and live GET only has Composition/Mint", () => {
    const nickel41087Taxonomy: EbayCategoryAspect[] = [
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
    const product = prepareLiveAspectsForInventoryPut(
      { Composition: ["Copper-Nickel"], Mint: ["Denver"] },
      "1938 Jefferson Nickel NGC MS 67",
      nickel41087Taxonomy,
      { categoryId: "41087", preserveLiveWireGrades: true },
      { Certification: ["NGC (Numismatic Guaranty Corporation)"], Grade: ["MS 67"], Year: ["1938"] }
    );
    expect(product["Letter grade"]).toEqual(["MS"]);
    expect(product["Numerical grade"]).toEqual(["67"]);
    expect(product["Professional grader"]).toEqual(["NGC"]);
  });

  it("uses canonical grader casing when taxonomy lists ALL CAPS parenthetical", () => {
    const taxonomy: EbayCategoryAspect[] = [
      {
        name: "Professional grader",
        required: true,
        mode: "SELECTION_ONLY",
        cardinality: "SINGLE",
        suggestedValues: ["NGC (NUMISMATIC GUARANTY CORPORATION)", "PCGS"],
      },
      {
        name: "Letter grade",
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
      { Certification: ["NGC (Numismatic Guaranty Corporation)"], Grade: ["MS 67"] },
      "1952-S NGC MS 67 Jefferson Nickel",
      taxonomy,
      { categoryId: "41087" },
      { Certification: ["NGC (Numismatic Guaranty Corporation)"], Grade: ["MS 67"] }
    );
    expect(product["Professional grader"]).toEqual(["NGC (NUMISMATIC GUARANTY CORPORATION)"]);
  });

  it("detects corrupted live Letter grade=67 on nickel 41087", () => {
    expect(
      liveInventoryWireGradesCorrupted(
        { "Letter grade": ["67"], "Numerical grade": ["67"], "Professional grader": ["NGC"] },
        "41087"
      )
    ).toBe(true);
  });

  it("repairs corrupted live Letter grade=67 from GetItem Grade MS 67", () => {
    const product = prepareLiveAspectsForInventoryPut(
      {
        "Letter grade": ["67"],
        "Numerical grade": ["67"],
        "Professional grader": ["NGC"],
        Year: ["1952"],
      },
      "1952-D NGC MS 67 Jefferson Nickel",
      nickelTaxonomy,
      { categoryId: "41087", preserveLiveWireGrades: false },
      { Certification: ["NGC"], Grade: ["MS 67"], Year: ["1952"] }
    );
    expect(product["Letter grade"]).toEqual(["MS"]);
    expect(product["Numerical grade"]).toEqual(["67"]);
    expect(product["Professional grader"]).toEqual(["NGC"]);
  });

  it("passthroughUsePreparedInventoryAspects when live wire grades corrupted", () => {
    expect(
      passthroughUsePreparedInventoryAspects(
        { "Letter grade": ["67"], "Numerical grade": ["67"], "Professional grader": ["NGC"] },
        "41087",
        { Certification: ["NGC"], Grade: ["MS 67"] },
        "1952-D NGC MS 67 Jefferson Nickel"
      )
    ).toBe(true);
  });
});

describe("normalizeEbayBrandValue", () => {
  it("keeps the seller value when taxonomy is unavailable", () => {
    expect(normalizeEbayBrandValue("Does Not Apply")).toBe("Does Not Apply");
    expect(normalizeEbayBrandValue("no brand")).toBe("no brand");
    expect(normalizeEbayBrandValue("Nintendo")).toBe("Nintendo");
  });

  it("keeps Does Not Apply when that is the official no-brand value", () => {
    expect(normalizeEbayBrandValue("Does Not Apply", ["Does Not Apply", "Nike"])).toBe("Does Not Apply");
  });

  it("maps Unbranded onto Does Not Apply when that is what eBay listed", () => {
    expect(normalizeEbayBrandValue("Unbranded", ["Does Not Apply", "Nike"])).toBe("Does Not Apply");
  });

  it("maps Does Not Apply onto Unbranded when that is what eBay listed", () => {
    expect(normalizeEbayBrandValue("Does Not Apply", ["Unbranded", "Nike"])).toBe("Unbranded");
  });
});

describe("sellerVisibleBrandChoices", () => {
  it("keeps official eBay values including Does Not Apply", () => {
    expect(sellerVisibleBrandChoices(["Nike", "Does Not Apply"])).toEqual(["Nike", "Does Not Apply"]);
  });
});

describe("restoreOftenRequiredSellerAspects", () => {
  it("puts seller Type/Brand back when remap dropped them", () => {
    const restored = restoreOftenRequiredSellerAspects(
      [
        {
          name: "Type",
          required: true,
          mode: "SELECTION_ONLY",
          cardinality: "SINGLE",
          suggestedValues: ["Clock", "Figurine"],
        },
        {
          name: "Brand",
          required: true,
          mode: "SELECTION_ONLY",
          cardinality: "SINGLE",
          suggestedValues: ["Unbranded", "Nintendo"],
        },
      ],
      [],
      [
        { name: "Type", value: "Clock" },
        { name: "Brand", value: "Does Not Apply" },
      ]
    );
    expect(restored.find((row) => row.name === "Type")?.value).toBe("Clock");
    expect(restored.find((row) => row.name === "Brand")?.value).toBe("Unbranded");
  });

  it("maps seller Unbranded onto Does Not Apply when that is the official value", () => {
    const restored = restoreOftenRequiredSellerAspects(
      [
        {
          name: "Brand",
          required: true,
          mode: "SELECTION_ONLY",
          cardinality: "SINGLE",
          suggestedValues: ["Does Not Apply", "Nike"],
        },
      ],
      [],
      [{ name: "Brand", value: "Unbranded" }]
    );
    expect(restored.find((row) => row.name === "Brand")?.value).toBe("Does Not Apply");
  });
});

describe("fillDefaultEbayAspects", () => {
  const schema: EbayCategoryAspect[] = [
    {
      name: "Brand",
      required: false,
      mode: "SELECTION_ONLY",
      cardinality: "SINGLE",
      suggestedValues: ["Nintendo", "Unbranded"],
    },
    {
      name: "Type",
      required: false,
      mode: "SELECTION_ONLY",
      cardinality: "SINGLE",
      suggestedValues: ["Clock", "Figurine"],
    },
  ];

  it("fills Unbranded when Brand is empty", () => {
    const filled = fillDefaultEbayAspects(schema, [], "Awesome Bear Clock");
    expect(filled.find((a) => a.name === "Brand")?.value).toBe("Unbranded");
    expect(filled.find((a) => a.name === "Type")?.value).toBe("Clock");
  });

  it("coerces stored Unbranded to Does Not Apply when that is the official value", () => {
    const filled = fillDefaultEbayAspects(
      [
        {
          name: "Brand",
          required: true,
          mode: "SELECTION_ONLY",
          cardinality: "SINGLE",
          suggestedValues: ["Does Not Apply", "Nike"],
        },
      ],
      [{ name: "Brand", value: "Unbranded" }],
      "Random object"
    );
    expect(filled.find((a) => a.name === "Brand")?.value).toBe("Does Not Apply");
  });

  it("reports Type as missing when it cannot be inferred", () => {
    const filled = fillDefaultEbayAspects(schema, [{ name: "Brand", value: "Unbranded" }], "Random object");
    expect(missingOftenRequiredEbayAspects(schema, filled)).toEqual(["Type"]);
  });
});

describe("ebayListOnFallbackAspects", () => {
  it("offers Type and Brand as text fields when taxonomy is unavailable", () => {
    const brand = ebayListOnFallbackAspects().find((aspect) => aspect.name === "Brand");
    expect(brand?.mode).toBe("FREE_TEXT");
    expect(brand?.suggestedValues).toEqual([]);
    expect(ebayAspectUsesDropdown(brand)).toBe(false);
  });
});

describe("ebayAspectRowsForListOnPopup", () => {
  it("shows required specifics and already-filled optional ones", () => {
    const schema: EbayCategoryAspect[] = [
      {
        name: "Brand",
        required: true,
        mode: "FREE_TEXT",
        cardinality: "SINGLE",
        suggestedValues: [],
      },
      {
        name: "Color",
        required: false,
        mode: "FREE_TEXT",
        cardinality: "SINGLE",
        suggestedValues: [],
      },
      {
        name: "Material",
        required: false,
        mode: "FREE_TEXT",
        cardinality: "SINGLE",
        suggestedValues: [],
      },
    ];
    const rows = ebayAspectRowsForListOnPopup(
      schema,
      [
        { name: "Color", value: "Blue" },
        { name: "Brand", value: "" },
      ],
      "Blue widget"
    );
    expect(rows.some((row) => row.name === "Brand")).toBe(true);
    expect(rows.find((row) => row.name === "Color")?.value).toBe("Blue");
    expect(rows.some((row) => row.name === "Material")).toBe(false);
  });

  it("includes Type even when taxonomy marks it optional", () => {
    const schema: EbayCategoryAspect[] = [
      {
        name: "Type",
        required: false,
        mode: "SELECTION_ONLY",
        cardinality: "SINGLE",
        suggestedValues: ["Clock", "Figurine"],
      },
      {
        name: "Brand",
        required: false,
        mode: "SELECTION_ONLY",
        cardinality: "SINGLE",
        suggestedValues: ["Unbranded"],
      },
    ];
    const rows = ebayAspectRowsForListOnPopup(schema, [], "Random object");
    expect(rows.some((row) => row.name === "Type")).toBe(true);
    expect(rows.some((row) => row.name === "Brand")).toBe(true);
  });

  it("fallback schema still collects Type and Brand", () => {
    const rows = ebayAspectRowsForListOnPopup(ebayListOnFallbackAspects(), [], "Random object");
    expect(rows.some((row) => row.name === "Type")).toBe(true);
    expect(rows.some((row) => row.name === "Brand")).toBe(true);
  });

  it("shows Type and Brand text fields when the official list is empty", () => {
    const rows = prepareAspectRowsForForm(ebayListOnFallbackAspects(), [], "Vintage Bear Clock");
    expect(rows.map((row) => row.name)).toEqual(["Type", "Brand"]);
    expect(ebayAspectUsesDropdown(ebayListOnFallbackAspects()[0])).toBe(false);
  });

  it("shows Brand as a text field when taxonomy is unavailable", () => {
    const brand = ebayListOnFallbackAspects().find((row) => row.name === "Brand");
    expect(ebayAspectUsesDropdown(brand)).toBe(false);
    expect(brand?.mode).toBe("FREE_TEXT");
  });

  it("does not treat a taxonomy outage as a missing item specific when Type and Brand are set", () => {
    expect(
      missingEbayAspectsForListOn(ebayListOnFallbackAspects(), [
        { name: "Type", value: "Wall Clock" },
        { name: "Brand", value: "Unbranded" },
      ])
    ).toEqual([]);
  });
});
