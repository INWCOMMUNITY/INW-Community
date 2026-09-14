import { describe, expect, it } from "vitest";
import {
  CANONICAL_SKU_MAX,
  clampEtsySku,
  ETSY_SKU_MAX,
  isCanonicalChannelSku,
  isEbayMigrationSku,
  isGeneratedVariantOfItemId,
  LISTING_SKU_MAX,
  normalizeListingSku,
  skuToAdoptFromRemote,
  toCanonicalChannelSku,
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
  it("fills an empty local SKU from an alphanumeric channel SKU", () => {
    expect(
      skuToAdoptFromRemote({ localSku: null, remoteSku: "COIN001", itemId: "item-1" })
    ).toBe("COIN001");
  });

  it("does not overwrite a seller SKU", () => {
    expect(
      skuToAdoptFromRemote({ localSku: "MINE", remoteSku: "THEIRS", itemId: "item-1" })
    ).toBeNull();
  });

  it("skips item ids and hyphenated strings; adopts live eBay inw pins", () => {
    expect(
      skuToAdoptFromRemote({
        localSku: null,
        remoteSku: "item-1",
        itemId: "item-1",
      })
    ).toBeNull();
    expect(
      skuToAdoptFromRemote({
        localSku: null,
        remoteSku: "COIN-001",
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
    ).toBe("inw403004607151");
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

describe("canonical channel SKU", () => {
  it("accepts alphanumeric codes at or under 32 characters", () => {
    expect(isCanonicalChannelSku("HAT42")).toBe(true);
    expect(isCanonicalChannelSku("a".repeat(CANONICAL_SKU_MAX))).toBe(true);
    expect(isCanonicalChannelSku("HAT-42")).toBe(false);
    expect(isCanonicalChannelSku("HAT 42")).toBe(false);
    expect(isCanonicalChannelSku("a".repeat(CANONICAL_SKU_MAX + 1))).toBe(false);
    expect(isCanonicalChannelSku("")).toBe(false);
    expect(isCanonicalChannelSku(null)).toBe(false);
  });

  it("strips punctuation and caps at 32", () => {
    expect(toCanonicalChannelSku("HAT-42")).toBe("HAT42");
    expect(toCanonicalChannelSku("  tshirt_bl_m  ")).toBe("tshirtblm");
    expect(toCanonicalChannelSku("a".repeat(40))).toHaveLength(CANONICAL_SKU_MAX);
    expect(toCanonicalChannelSku("---")).toBeNull();
    expect(toCanonicalChannelSku(null)).toBeNull();
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
