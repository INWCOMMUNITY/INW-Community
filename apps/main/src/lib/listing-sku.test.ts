import { describe, expect, it } from "vitest";
import {
  clampEtsySku,
  ETSY_SKU_MAX,
  isEbayMigrationSku,
  isGeneratedVariantOfItemId,
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

  it("does not adopt Shopify-generated itemId-option SKUs as the parent SKU", () => {
    expect(
      skuToAdoptFromRemote({
        localSku: null,
        remoteSku: "cmt7vumcl000dxjujvgwe8dob-Purple",
        itemId: "cmt7vumcl000dxjujvgwe8dob",
      })
    ).toBeNull();
  });
});

describe("clampEtsySku", () => {
  it("keeps SKUs that already fit Etsy's 32-character cap", () => {
    expect(clampEtsySku("HAT-42")).toBe("HAT-42");
    expect(clampEtsySku("a".repeat(ETSY_SKU_MAX))).toHaveLength(ETSY_SKU_MAX);
  });

  it("maps long Size × Color SKUs to unique codes at or under 32 characters", () => {
    const itemId = "cmt98fbq10001gm0yox25pnfg";
    const sizes = ["Small", "Medium", "Large"];
    const colors = ["Black", "Red", "Blue", "Green"];
    const codes = sizes.flatMap((size) =>
      colors.map((color) => clampEtsySku(`${itemId}${size}${color}`, `${itemId}:${size}:${color}`))
    );
    expect(codes).toHaveLength(12);
    expect(new Set(codes).size).toBe(12);
    expect(codes.every((code) => code.length <= ETSY_SKU_MAX)).toBe(true);
    expect(codes.every((code) => /^[a-zA-Z0-9]+$/.test(code))).toBe(true);
  });
});

describe("isGeneratedVariantOfItemId", () => {
  const itemId = "cmt7vumcl000dxjujvgwe8dob";

  it("detects hyphenated and stripped itemId-option SKUs", () => {
    expect(isGeneratedVariantOfItemId(`${itemId}-Purple`, itemId)).toBe(true);
    expect(isGeneratedVariantOfItemId(`${itemId}Purple`, itemId)).toBe(true);
    expect(isGeneratedVariantOfItemId(itemId, itemId)).toBe(true);
  });

  it("leaves real seller SKUs alone", () => {
    expect(isGeneratedVariantOfItemId("HAT-42", itemId)).toBe(false);
    expect(isGeneratedVariantOfItemId("HAT42", itemId)).toBe(false);
  });
});
