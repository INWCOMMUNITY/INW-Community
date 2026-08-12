import { describe, expect, it } from "vitest";
import {
  conditionEnumFromId,
  conditionIdFromEnum,
  defaultEbayConditionEnum,
  inwConditionFromEbayEnum,
  isEbayConditionSyncError,
  presentEbayConditionChoices,
  resolveEbayInventoryCondition,
  type EbayConditionChoice,
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

describe("inwConditionFromEbayEnum", () => {
  it("maps enums to INW condition", () => {
    expect(inwConditionFromEbayEnum("NEW")).toBe("new");
    expect(inwConditionFromEbayEnum("USED_EXCELLENT")).toBe("used");
    expect(conditionIdFromEnum("NEW")).toBe(1000);
    expect(defaultEbayConditionEnum("used")).toBe("USED_EXCELLENT");
  });
});
