import { describe, expect, it } from "vitest";
import { matchSaleToVariantOption, remoteVariantMatrixIsWeaker, validateVariantLimits, variantsPayloadForImport } from "./variant-sync";

const matrix = {
  axes: [
    { name: "Size", values: ["S", "M"] },
    { name: "Color", values: ["Navy", "White"] },
  ],
  skus: [
    { options: { Size: "S", Color: "Navy" }, quantity: 2 },
    { options: { Size: "M", Color: "Navy" }, quantity: 3 },
  ],
};

describe("matchSaleToVariantOption", () => {
  it("matches Shopify slash titles like S / Navy to the combination", () => {
    expect(matchSaleToVariantOption({ Option: "S / Navy" }, matrix)).toEqual({
      Size: "S",
      Color: "Navy",
    });
  });

  it("matches a full option map", () => {
    expect(matchSaleToVariantOption({ Size: "M", Color: "Navy" }, matrix)).toEqual({
      Size: "M",
      Color: "Navy",
    });
  });
});

describe("variantsPayloadForImport", () => {
  it("stores a Shopify combo matrix instead of collapsing to legacy axes", () => {
    const stored = variantsPayloadForImport({
      variantsKnown: true,
      variants: {
        axes: [
          { name: "Size", values: ["S", "M"] },
          {
            name: "Color",
            values: ["Navy", "White"],
            photosByValue: { Navy: ["https://cdn.example/navy.jpg"] },
          },
        ],
        imageAxis: "Color",
        skus: [
          { options: { Size: "S", Color: "Navy" }, quantity: 2, priceCents: 2200 },
          { options: { Size: "S", Color: "White" }, quantity: 1 },
          { options: { Size: "M", Color: "Navy" }, quantity: 3, photos: ["https://cdn.example/navy.jpg"] },
        ],
      },
    });
    expect(Array.isArray(stored)).toBe(false);
    expect(stored?.skus).toHaveLength(3);
    expect(stored?.skus.map((s) => s.quantity)).toEqual([2, 1, 3]);
    expect(stored?.axes.find((a) => a.name === "Color")?.photosByValue?.Navy).toEqual([
      "https://cdn.example/navy.jpg",
    ]);
    expect(stored?.skus.find((s) => s.options.Color === "Navy")?.photos).toEqual([
      "https://cdn.example/navy.jpg",
    ]);
  });

  it("stores Etsy combo rows with per-SKU qty instead of per-color totals", () => {
    const stored = variantsPayloadForImport({
      variants: {
        axes: [
          { name: "Size", values: ["S", "M"] },
          { name: "Color", values: ["Navy"] },
        ],
        skus: [
          { options: { Size: "S", Color: "Navy" }, quantity: 2, priceCents: 2500 },
          { options: { Size: "M", Color: "Navy" }, quantity: 1, priceCents: 2500 },
        ],
        quantitiesVary: true,
        pricesVary: false,
      },
    });
    expect(stored?.skus).toHaveLength(2);
    expect(stored?.skus[0].quantity).toBe(2);
    expect(stored?.skus[1].quantity).toBe(1);
    expect(stored?.pricesVary).toBe(false);
    expect(stored?.quantitiesVary).toBe(true);
    expect(stored?.skus[0].priceCents).toBeUndefined();
  });

  it("skips variants when the provider did not know them", () => {
    expect(variantsPayloadForImport({ variantsKnown: false, variants: { axes: [], skus: [] } })).toBeNull();
  });
});

describe("remoteVariantMatrixIsWeaker", () => {
  const sizeColor = {
    axes: [
      { name: "Size", values: ["S", "M"] },
      { name: "Color", values: ["Navy"] },
    ],
    skus: [
      { options: { Size: "S", Color: "Navy" }, quantity: 2 },
      { options: { Size: "M", Color: "Navy" }, quantity: 1 },
    ],
  };
  const colorOnly = {
    axes: [{ name: "Color", values: ["Navy", "White"] }],
    skus: [
      { options: { Color: "Navy" }, quantity: 3 },
      { options: { Color: "White" }, quantity: 1 },
    ],
  };

  it("blocks Etsy Color-only inventory from replacing Size × Color", () => {
    expect(remoteVariantMatrixIsWeaker(sizeColor, colorOnly)).toBe(true);
  });

  it("blocks Color-only remote when INW combination rows still have Size", () => {
    expect(
      remoteVariantMatrixIsWeaker(
        {
          axes: [{ name: "Color", values: ["Navy"] }],
          skus: [
            { options: { Size: "S", Color: "Navy" }, quantity: 2 },
            { options: { Size: "M", Color: "Navy" }, quantity: 1 },
          ],
        },
        colorOnly
      )
    ).toBe(true);
  });

  it("allows filling empty INW variants from remote", () => {
    expect(remoteVariantMatrixIsWeaker(null, sizeColor)).toBe(false);
  });

  it("allows a same-shape remote update", () => {
    expect(remoteVariantMatrixIsWeaker(sizeColor, sizeColor)).toBe(false);
  });
});

describe("validateVariantLimits", () => {
  it("blocks Shopify REST above 100 combinations", () => {
    const sizes = Array.from({ length: 11 }, (_, i) => String(i));
    const colors = Array.from({ length: 10 }, (_, i) => String(i));
    expect(
      validateVariantLimits("shopify", {
        axes: [
          { name: "Size", values: sizes },
          { name: "Color", values: colors },
        ],
        skus: sizes.flatMap((s) => colors.map((c) => ({ options: { Size: s, Color: c }, quantity: 1 }))),
      })
    ).toMatch(/100/);
  });
});
