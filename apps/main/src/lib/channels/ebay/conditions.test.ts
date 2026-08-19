import { describe, expect, it } from "vitest";
import {
  buildConditionDescriptorsFromAspects,
  conditionEnumFromId,
  conditionIdFromEnum,
  defaultEbayConditionEnum,
  inwConditionFromEbayEnum,
  isEbayConditionSyncError,
  parseConditionDescriptorMetadata,
  preserveOrBuildConditionDescriptorsOnBody,
  presentEbayConditionChoices,
  resolveEbayInventoryCondition,
  resolveEbaySyncConditionFromChoices,
  type EbayConditionChoice,
  type EbayConditionDescriptorMeta,
} from "./conditions";

describe("conditionEnumFromId", () => {
  it("maps known eBay condition IDs", () => {
    expect(conditionEnumFromId(1000)).toBe("NEW");
    expect(conditionEnumFromId(3000)).toBe("USED_EXCELLENT");
  });
});

describe("resolveEbayInventoryCondition", () => {
  it("uses override when set", () => {
    expect(
      resolveEbayInventoryCondition({ condition: "new", ebayConditionEnum: "USED_VERY_GOOD" })
    ).toBe("USED_VERY_GOOD");
  });

  it("falls back to INW new/used defaults", () => {
    expect(resolveEbayInventoryCondition({ condition: "used" })).toBe("USED_EXCELLENT");
    expect(resolveEbayInventoryCondition({ condition: "new" })).toBe("NEW");
  });
});

describe("presentEbayConditionChoices", () => {
  it("returns binary New/Used for standard categories", () => {
    const choices: EbayConditionChoice[] = [
      { conditionId: 1000, enum: "NEW", label: "New", group: "new" },
      { conditionId: 3000, enum: "USED_EXCELLENT", label: "Used", group: "used" },
    ];
    const presentation = presentEbayConditionChoices(choices);
    expect(presentation.mode).toBe("binary");
    if (presentation.mode === "binary") {
      expect(presentation.newOption.enum).toBe("NEW");
      expect(presentation.usedOption.enum).toBe("USED_EXCELLENT");
    }
  });
});

describe("isEbayConditionSyncError", () => {
  it("detects error 25021", () => {
    expect(
      isEbayConditionSyncError(
        "[#25021 · API_INVENTORY · Request · HTTP 400] invalid item condition"
      )
    ).toBe(true);
    expect(isEbayConditionSyncError("token expired")).toBe(false);
  });
});

describe("resolveEbaySyncConditionFromChoices", () => {
  const choices: EbayConditionChoice[] = [
    { conditionId: 3000, enum: "USED_EXCELLENT", label: "Used", group: "used" },
    { conditionId: 5000, enum: "USED_GOOD", label: "Used - Good", group: "used" },
  ];

  it("keeps a valid stored override", () => {
    expect(
      resolveEbaySyncConditionFromChoices(
        { condition: "used", ebayConditionEnum: "USED_GOOD" },
        choices
      )
    ).toEqual({ conditionEnum: "USED_GOOD", autoCorrected: false });
  });

  it("auto-corrects invalid defaults to category-allowed enum", () => {
    const gradedUsed: EbayConditionChoice[] = [
      { conditionId: 4000, enum: "USED_VERY_GOOD", label: "Very Good", group: "used" },
      { conditionId: 5000, enum: "USED_GOOD", label: "Used - Good", group: "used" },
    ];
    expect(resolveEbaySyncConditionFromChoices({ condition: "used", ebayConditionEnum: null }, gradedUsed)).toEqual({
      conditionEnum: "USED_VERY_GOOD",
      autoCorrected: true,
    });
  });
});

describe("inwConditionFromEbayEnum", () => {
  it("maps enums to INW condition", () => {
    expect(inwConditionFromEbayEnum("NEW")).toBe("new");
    expect(inwConditionFromEbayEnum("USED_EXCELLENT")).toBe("used");
    expect(conditionIdFromEnum("NEW")).toBe(1000);
    expect(defaultEbayConditionEnum("used")).toBe("USED_EXCELLENT");
  });
});

const coinConditionDescriptorMeta: EbayConditionDescriptorMeta[] = parseConditionDescriptorMetadata([
  {
    conditionDescriptors: [
      {
        conditionDescriptorId: "27501",
        conditionDescriptorName: "Professional Grader",
        conditionDescriptorConstraint: { aspectRequired: true },
        conditionDescriptorValues: [
          { conditionDescriptorValueId: "275010", conditionDescriptorValueName: "NGC" },
        ],
      },
      {
        conditionDescriptorId: "27503",
        conditionDescriptorName: "Letter grade",
        conditionDescriptorConstraint: { aspectRequired: true },
        conditionDescriptorValues: [
          { conditionDescriptorValueId: "275031", conditionDescriptorValueName: "PR" },
          { conditionDescriptorValueId: "275030", conditionDescriptorValueName: "MS" },
        ],
      },
      {
        conditionDescriptorId: "27504",
        conditionDescriptorName: "Numerical grade",
        conditionDescriptorConstraint: { aspectRequired: true },
        conditionDescriptorValues: [
          { conditionDescriptorValueId: "275040", conditionDescriptorValueName: "67" },
          { conditionDescriptorValueId: "275041", conditionDescriptorValueName: "69" },
        ],
      },
    ],
  },
]);

describe("buildConditionDescriptorsFromAspects", () => {
  it("maps grader and grade aspects to descriptor ids", () => {
    const descriptors = buildConditionDescriptorsFromAspects(
      {
        Certification: ["NGC"],
        "Professional grader": ["NGC"],
        "Letter grade": ["MS"],
        "Numerical grade": ["67"],
      },
      coinConditionDescriptorMeta
    );
    expect(descriptors).toEqual([
      { name: "27501", values: ["275010"] },
      { name: "27503", values: ["275030"] },
      { name: "27504", values: ["275040"] },
    ]);
  });

  it("maps Roosevelt dime PR 69 wire aspects to numeric letter descriptor and 69 numeric descriptor", () => {
    const dimeDescriptorMeta: EbayConditionDescriptorMeta[] = parseConditionDescriptorMetadata([
      {
        conditionDescriptors: [
          {
            conditionDescriptorId: "27501",
            conditionDescriptorName: "Professional Grader",
            conditionDescriptorValues: [
              { conditionDescriptorValueId: "275010", conditionDescriptorValueName: "NGC" },
            ],
          },
          {
            conditionDescriptorId: "27503",
            conditionDescriptorName: "Letter grade",
            conditionDescriptorValues: [
              { conditionDescriptorValueId: "275031", conditionDescriptorValueName: "PR" },
              { conditionDescriptorValueId: "275069", conditionDescriptorValueName: "69" },
            ],
          },
          {
            conditionDescriptorId: "27504",
            conditionDescriptorName: "Numerical grade",
            conditionDescriptorValues: [
              { conditionDescriptorValueId: "275041", conditionDescriptorValueName: "69" },
            ],
          },
        ],
      },
    ]);
    const descriptors = buildConditionDescriptorsFromAspects(
      {
        "Professional grader": ["NGC"],
        "Letter grade": ["69"],
        "Numerical grade": ["69"],
        Grade: ["PR 69"],
      },
      dimeDescriptorMeta,
      "2002-S NGC PR 69 Ultra Cameo Roosevelt Dime",
      "39458"
    );
    expect(descriptors).toEqual([
      { name: "27501", values: ["275010"] },
      { name: "27503", values: ["275069"] },
      { name: "27504", values: ["275041"] },
    ]);
  });

  it("does not map numeric-only Letter grade aspect to a letter-grade descriptor value", () => {
    const metaWithNumericLetter: EbayConditionDescriptorMeta[] = parseConditionDescriptorMetadata([
      {
        conditionDescriptors: [
          {
            conditionDescriptorId: "27503",
            conditionDescriptorName: "Letter grade",
            conditionDescriptorValues: [
              { conditionDescriptorValueId: "275031", conditionDescriptorValueName: "PR" },
              { conditionDescriptorValueId: "275069", conditionDescriptorValueName: "69" },
            ],
          },
          {
            conditionDescriptorId: "27504",
            conditionDescriptorName: "Numerical grade",
            conditionDescriptorValues: [
              { conditionDescriptorValueId: "275041", conditionDescriptorValueName: "69" },
            ],
          },
        ],
      },
    ]);
    const descriptors = buildConditionDescriptorsFromAspects(
      {
        "Letter grade": ["69"],
        "Numerical grade": ["69"],
      },
      metaWithNumericLetter,
      "Generic coin title without grade prefix",
      "39458"
    );
    expect(descriptors).toEqual([
      { name: "27503", values: ["275069"] },
      { name: "27504", values: ["275041"] },
    ]);
  });
});

describe("preserveOrBuildConditionDescriptorsOnBody", () => {
  it("rebuilds conditionDescriptors from aspects instead of preserving stale live values", () => {
    const dimeDescriptorMeta: EbayConditionDescriptorMeta[] = parseConditionDescriptorMetadata([
      {
        conditionDescriptors: [
          {
            conditionDescriptorId: "27501",
            conditionDescriptorName: "Professional Grader",
            conditionDescriptorValues: [
              { conditionDescriptorValueId: "275010", conditionDescriptorValueName: "NGC" },
            ],
          },
          {
            conditionDescriptorId: "27503",
            conditionDescriptorName: "Letter grade",
            conditionDescriptorValues: [
              { conditionDescriptorValueId: "275069", conditionDescriptorValueName: "69" },
            ],
          },
          {
            conditionDescriptorId: "27504",
            conditionDescriptorName: "Numerical grade",
            conditionDescriptorValues: [
              { conditionDescriptorValueId: "275041", conditionDescriptorValueName: "69" },
            ],
          },
        ],
      },
    ]);
    const body = preserveOrBuildConditionDescriptorsOnBody(
      {
        product: {
          aspects: {
            "Professional grader": ["NGC"],
            "Letter grade": ["69"],
            "Numerical grade": ["69"],
          },
        },
      },
      { conditionDescriptors: [{ name: "27503", values: ["275030"] }] },
      {
        "Professional grader": ["NGC"],
        "Letter grade": ["69"],
        "Numerical grade": ["69"],
      },
      dimeDescriptorMeta,
      "2002-S NGC PR 69 Ultra Cameo Roosevelt Dime",
      "39458"
    );
    expect(body.conditionDescriptors).toEqual([
      { name: "27501", values: ["275010"] },
      { name: "27503", values: ["275069"] },
      { name: "27504", values: ["275041"] },
    ]);
  });

  it("falls back to live conditionDescriptors when aspects cannot build descriptors", () => {
    const body = preserveOrBuildConditionDescriptorsOnBody(
      { product: { aspects: { "Professional grader": ["NGC"] } } },
      { conditionDescriptors: [{ name: "27501", values: ["275010"] }] },
      {},
      []
    );
    expect(body.conditionDescriptors).toEqual([{ name: "27501", values: ["275010"] }]);
  });
});
