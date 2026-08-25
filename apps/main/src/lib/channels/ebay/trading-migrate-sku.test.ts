import { describe, expect, it } from "vitest";
import { generateEbayMigrationSku, isValidEbayInventorySku } from "./trading";
import { ebayErrorActionHint } from "./errors";

describe("isValidEbayInventorySku", () => {
  it("accepts alphanumeric SKUs up to 50 characters", () => {
    expect(isValidEbayInventorySku("inw393111584313")).toBe(true);
    expect(isValidEbayInventorySku("ABC123")).toBe(true);
  });

  it("rejects hyphens, spaces, empty, and over-length SKUs", () => {
    expect(isValidEbayInventorySku("1942-S")).toBe(false);
    expect(isValidEbayInventorySku("sku b")).toBe(false);
    expect(isValidEbayInventorySku("")).toBe(false);
    expect(isValidEbayInventorySku("a".repeat(51))).toBe(false);
  });
});

describe("generateEbayMigrationSku", () => {
  it("builds an alphanumeric SKU from the listing id", () => {
    expect(generateEbayMigrationSku("393111584313")).toBe("inw393111584313");
    expect(generateEbayMigrationSku("393-111")).toBe("inw393111");
    expect(generateEbayMigrationSku("1".repeat(60)).length).toBeLessThanOrEqual(50);
  });
});

describe("empty SKU migrate hint", () => {
  it("does not treat empty-SKU #25002 as a GTC listing problem", () => {
    const reason =
      "[#25002 · API_INVENTORY · REQUEST · HTTP 400] A user error has occurred. The listing SKU cannot be null or empty.";
    expect(ebayErrorActionHint(reason)).toMatch(/Custom Label/i);
    expect(ebayErrorActionHint(reason)).not.toMatch(/GTC listing/i);
  });
});
