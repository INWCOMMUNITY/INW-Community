import { describe, expect, it } from "vitest";
import {
  isEbayMigrationSku,
  LISTING_SKU_MAX,
  normalizeListingSku,
  skuToAdoptFromRemote,
} from "./listing-sku";

describe("normalizeListingSku", () => {
  it("trims and caps length", () => {
    expect(normalizeListingSku("  HAT-42  ")).toBe("HAT-42");
    expect(normalizeListingSku("a".repeat(LISTING_SKU_MAX + 8))).toHaveLength(LISTING_SKU_MAX);
    expect(normalizeListingSku("   ")).toBeNull();
    expect(normalizeListingSku(null)).toBeNull();
  });
});

describe("skuToAdoptFromRemote", () => {
  it("fills an empty local SKU from the channel", () => {
    expect(
      skuToAdoptFromRemote({ localSku: null, remoteSku: "COIN-001", itemId: "item-1" })
    ).toBe("COIN-001");
  });

  it("does not overwrite a seller SKU", () => {
    expect(
      skuToAdoptFromRemote({ localSku: "MINE", remoteSku: "THEIRS", itemId: "item-1" })
    ).toBeNull();
  });

  it("skips item ids and eBay migration keys", () => {
    expect(
      skuToAdoptFromRemote({
        localSku: null,
        remoteSku: "item-1",
        itemId: "item-1",
      })
    ).toBeNull();
    expect(isEbayMigrationSku("inw403004607151")).toBe(true);
    expect(
      skuToAdoptFromRemote({
        localSku: null,
        remoteSku: "inw403004607151",
        itemId: "item-1",
      })
    ).toBeNull();
  });
});
