import { describe, expect, it } from "vitest";
import {
  adoptPinnedEbaySku,
  ensureSellableSkus,
  matchAllowsChannelWrite,
  requireSellableSkusForPublish,
  resolvePublishSku,
  SkuIdentityError,
  skusExact,
} from "./sku-identity";

describe("resolvePublishSku", () => {
  it("returns a join-key SKU unchanged", () => {
    expect(resolvePublishSku({ sku: "HAT42", itemId: "item-1" })).toBe("HAT42");
    expect(resolvePublishSku({ sku: "inw404516850572", itemId: "item-1" })).toBe("inw404516850572");
  });

  it("rejects blank, item id, leftover parent, and hyphens", () => {
    expect(() => resolvePublishSku({ sku: null, itemId: "item-1" })).toThrow(SkuIdentityError);
    expect(() => resolvePublishSku({ sku: "item-1", itemId: "item-1" })).toThrow(SkuIdentityError);
    expect(() =>
      resolvePublishSku({
        sku: "cmt7vumcl000dxjujvgwe8dob-Purple",
        itemId: "cmt7vumcl000dxjujvgwe8dob",
      })
    ).toThrow(SkuIdentityError);
    expect(() => resolvePublishSku({ sku: "HAT-42", itemId: "item-1" })).toThrow(SkuIdentityError);
  });

  it("enforces Etsy 32 and Wix 40", () => {
    expect(() =>
      resolvePublishSku({ sku: "a".repeat(33), itemId: "item-1", channel: "etsy" })
    ).toThrow(/32/);
    expect(() =>
      resolvePublishSku({ sku: "a".repeat(41), itemId: "item-1", channel: "wix" })
    ).toThrow(/40/);
  });
});

describe("ensureSellableSkus", () => {
  it("mints a hub join key when a simple listing has no SKU", () => {
    const used = new Set<string>();
    const result = ensureSellableSkus({ id: "item-1", sku: null, variants: null }, used);
    expect(result.changed).toBe(true);
    expect(result.sku).toMatch(/^nwc[a-zA-Z0-9]{10}$/);
    expect(used.has(result.sku!.toLowerCase())).toBe(true);
  });

  it("keeps a live eBay pin and canonicalizes hyphenated seller SKUs", () => {
    const used = new Set<string>();
    expect(
      ensureSellableSkus(
        { id: "cmt8zc266000dw2tzrmx9rie1", sku: "inw404516850572", variants: null },
        used
      ).sku
    ).toBe("inw404516850572");
    expect(
      ensureSellableSkus({ id: "item-1", sku: "HAT-42", variants: null }, new Set()).sku
    ).toBe("HAT42");
  });

  it("mints unique combo SKUs and clears an item-id leftover parent", () => {
    const itemId = "cmt7vumcl000dxjujvgwe8dob";
    const result = ensureSellableSkus(
      {
        id: itemId,
        sku: `${itemId}-Purple`,
        variants: {
          axes: [{ name: "Size", values: ["S", "M"] }],
          skus: [
            { options: { Size: "S" }, quantity: 1 },
            { options: { Size: "M" }, quantity: 1 },
          ],
        },
      },
      new Set()
    );
    expect(result.sku).toBeNull();
    const matrix = result.variants as { skus: { sku: string }[] };
    expect(matrix.skus.map((s) => s.sku)).toHaveLength(2);
    expect(new Set(matrix.skus.map((s) => s.sku)).size).toBe(2);
    expect(matrix.skus.every((s) => /^nwc[a-zA-Z0-9]{10}$/.test(s.sku))).toBe(true);
  });
});

describe("requireSellableSkusForPublish", () => {
  it("requires a combo SKU on every row", () => {
    expect(() =>
      requireSellableSkusForPublish({
        id: "item-1",
        sku: "HAT",
        variants: {
          axes: [{ name: "Size", values: ["S"] }],
          skus: [{ options: { Size: "S" }, quantity: 1 }],
        },
      })
    ).toThrow(SkuIdentityError);
    expect(
      requireSellableSkusForPublish({
        id: "item-1",
        sku: "HAT",
        variants: {
          axes: [{ name: "Size", values: ["S"] }],
          skus: [{ options: { Size: "S" }, quantity: 1, sku: "HATS" }],
        },
      })
    ).toEqual(["HATS"]);
  });
});

describe("adoptPinnedEbaySku", () => {
  it("adopts live eBay inw pins onto blank INW", () => {
    expect(
      adoptPinnedEbaySku({
        localSku: null,
        remoteSku: "inw404516850572",
        itemId: "cmt8zc266000dw2tzrmx9rie1",
      })
    ).toBe("inw404516850572");
  });

  it("rejects item-id leftovers and does not overwrite a seller SKU", () => {
    expect(
      adoptPinnedEbaySku({
        localSku: null,
        remoteSku: "cmt7vumcl000dxjujvgwe8dob-Purple",
        itemId: "cmt7vumcl000dxjujvgwe8dob",
      })
    ).toBeNull();
    expect(
      adoptPinnedEbaySku({ localSku: "MINE", remoteSku: "inw404516850572", itemId: "item-1" })
    ).toBeNull();
  });
});

describe("matchAllowsChannelWrite", () => {
  it("requires exact SKU quality, not option or case-folded matches", () => {
    expect(
      matchAllowsChannelWrite({ quality: "sku", inwSku: "HAT42", remoteSku: "HAT42" })
    ).toBe(true);
    expect(
      matchAllowsChannelWrite({ quality: "sku", inwSku: "HAT42", remoteSku: "hat42" })
    ).toBe(false);
    expect(
      matchAllowsChannelWrite({ quality: "values", inwSku: "HAT42", remoteSku: "HAT42" })
    ).toBe(false);
    expect(skusExact("HAT42", "HAT42")).toBe(true);
    expect(skusExact("HAT42", "hat42")).toBe(false);
  });
});
