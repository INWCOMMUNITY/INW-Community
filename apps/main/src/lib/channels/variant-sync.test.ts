import { describe, expect, it } from "vitest";
import { matchSaleToVariantOption, validateVariantLimits } from "./variant-sync";

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
