import { describe, expect, it } from "vitest";
import {
  buildConditionDescriptorsFromAspects,
  conditionEnumFromId,
  conditionIdFromEnum,
  defaultEbayConditionEnum,
  inwConditionFromEbayEnum,
  isEbayConditionSyncError,
  parseConditionDescriptorMetadata,
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

describe("buildConditionDescriptorsFromAspects", () => {
  const metadata: EbayConditionDescriptorMeta[] = parseConditionDescriptorMetadata([
    {
      conditionDescriptors: [
        {
          conditionDescriptorId: "27501",
          conditionDescriptorName: "Professional Grader",
          conditionDescriptorConstraint: { aspectRequired: true },
          conditionDescriptorValues: [
            { conditionDescriptorValueId: "275010", conditionDescriptorValueName: "PCGS" },
          ],
        },
        {
          conditionDescriptorId: "27502",
          conditionDescriptorName: "Grade",
          conditionDescriptorConstraint: { aspectRequired: true },
          conditionDescriptorValues: [
            { conditionDescriptorValueId: "275020", conditionDescriptorValueName: "67" },
          ],
        },
      ],
    },
  ]);

  it("maps grader and grade aspects to descriptor ids", () => {
    const descriptors = buildConditionDescriptorsFromAspects(
      {
        "Professional grader": ["PCGS"],
        "Numerical grade": ["67"],
      },
      metadata
    );
    expect(descriptors).toEqual([
      { name: "27501", values: ["275010"] },
      { name: "27502", values: ["275020"] },
    ]);
  });
});
