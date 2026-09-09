import { describe, expect, it } from "vitest";
import {
  browsePriceLabel,
  decrementMatrixSku,
  incrementMatrixSku,
  normalizeVariantMatrix,
  rebuildMatrixFromAxes,
  serializeVariantMatrix,
  validateVariantMatrixForSave,
} from "./listing-variant-matrix";
import { validateInwVariantsForSave } from "./channels/variant-sync";
import {
  decrementOptionQuantity,
  getAvailableQuantity,
  getSkuPriceCents,
  sumOptionQuantities,
} from "./store-item-variants";

describe("normalizeVariantMatrix", () => {
  it("keeps a Size × Color SKU matrix", () => {
    const matrix = normalizeVariantMatrix({
      axes: [
        { name: "Size", values: ["S", "M"] },
        { name: "Color", values: ["Navy"] },
      ],
      skus: [
        { options: { Size: "S", Color: "Navy" }, quantity: 2, priceCents: 2500 },
        { options: { Size: "M", Color: "Navy" }, quantity: 1 },
      ],
    });
    expect(matrix?.skus).toHaveLength(2);
    expect(matrix?.skus[0].priceCents).toBe(2500);
  });

  it("normalizes legacy single-axis JSON", () => {
    const matrix = normalizeVariantMatrix([
      {
        name: "Size",
        options: [
          { value: "S", quantity: 3, sku: "S1" },
          { value: "M", quantity: 1 },
        ],
      },
    ]);
    expect(matrix?.axes).toEqual([{ name: "Size", values: ["S", "M"] }]);
    expect(matrix?.skus).toEqual([
      { options: { Size: "S" }, quantity: 3, sku: "S1" },
      { options: { Size: "M" }, quantity: 1 },
    ]);
  });

  it("fans photosByValue onto matching SKU rows", () => {
    const matrix = normalizeVariantMatrix({
      axes: [
        { name: "Size", values: ["S"] },
        {
          name: "Color",
          values: ["Navy", "White"],
          photosByValue: { Navy: ["https://cdn.example/navy.jpg"] },
        },
      ],
      imageAxis: "Color",
      skus: [
        { options: { Size: "S", Color: "Navy" }, quantity: 1 },
        { options: { Size: "S", Color: "White" }, quantity: 1 },
      ],
    });
    expect(matrix?.imageAxis).toBe("Color");
    expect(matrix?.skus[0].photos).toEqual(["https://cdn.example/navy.jpg"]);
    expect(matrix?.skus[1].photos).toBeUndefined();
  });
});

describe("validateInwVariantsForSave", () => {
  it("allows 2–3 axes within the default 100 SKU cap", () => {
    const matrix = rebuildMatrixFromAxes(
      [
        { name: "Size", values: ["S", "M"] },
        { name: "Color", values: ["Navy", "White"] },
      ],
      []
    );
    expect(validateInwVariantsForSave(matrix)).toBeNull();
    expect(validateVariantMatrixForSave(matrix)).toBeNull();
  });

  it("builds a three-axis cartesian table", () => {
    const rebuilt = rebuildMatrixFromAxes(
      [
        { name: "Size", values: ["S", "M"] },
        { name: "Color", values: ["Navy"] },
        { name: "Fit", values: ["Slim", "Regular"] },
      ],
      [{ options: { Size: "S", Color: "Navy", Fit: "Slim" }, quantity: 4, priceCents: 2100 }]
    );
    expect(rebuilt.skus).toHaveLength(4);
    expect(rebuilt.skus.find((s) => s.options.Fit === "Slim" && s.options.Size === "S")?.quantity).toBe(4);
    expect(rebuilt.skus.find((s) => s.options.Fit === "Regular")?.quantity).toBe(0);
  });

  it("caps INW saves at 250 combinations", () => {
    const sizes = Array.from({ length: 25 }, (_, i) => `S${i}`);
    const colors = Array.from({ length: 11 }, (_, i) => `C${i}`);
    expect(
      validateVariantMatrixForSave({
        axes: [
          { name: "Size", values: sizes },
          { name: "Color", values: colors },
        ],
        skus: sizes.flatMap((s) => colors.map((c) => ({ options: { Size: s, Color: c }, quantity: 1 }))),
      })
    ).toMatch(/250/);
  });

  it("omits price and SKU when vary flags are off", () => {
    const serialized = serializeVariantMatrix({
      axes: [{ name: "Size", values: ["S"] }],
      skus: [{ options: { Size: "S" }, quantity: 1, priceCents: 2000, sku: "X" }],
      pricesVary: false,
      skusVary: false,
    });
    expect(serialized.skus[0].priceCents).toBeUndefined();
    expect(serialized.skus[0].sku).toBeUndefined();
    expect(serialized.pricesVary).toBe(false);
    expect(serialized.skusVary).toBe(false);
  });

  it("rejects a fourth option type", () => {
    expect(
      validateInwVariantsForSave({
        axes: [
          { name: "A", values: ["1"] },
          { name: "B", values: ["1"] },
          { name: "C", values: ["1"] },
          { name: "D", values: ["1"] },
        ],
        skus: [{ options: { A: "1", B: "1", C: "1", D: "1" }, quantity: 1 }],
      })
    ).toMatch(/3 option types/i);
  });
});

describe("cartesian inventory", () => {
  const matrix = {
    axes: [
      { name: "Size", values: ["S", "M"] },
      { name: "Color", values: ["Navy", "White"] },
    ],
    skus: [
      { options: { Size: "S", Color: "Navy" }, quantity: 4 },
      { options: { Size: "S", Color: "White" }, quantity: 1 },
      { options: { Size: "M", Color: "Navy" }, quantity: 0 },
      { options: { Size: "M", Color: "White" }, quantity: 2 },
    ],
  };

  it("decrements only the selected combination", () => {
    const next = decrementMatrixSku(matrix, { Size: "S", Color: "Navy" }, 2);
    expect(next?.skus.find((s) => s.options.Size === "S" && s.options.Color === "Navy")?.quantity).toBe(2);
    expect(next?.skus.find((s) => s.options.Size === "S" && s.options.Color === "White")?.quantity).toBe(1);
  });

  it("increments the same combination", () => {
    const next = incrementMatrixSku(matrix, { Size: "M", Color: "White" }, 3);
    expect(next?.skus.find((s) => s.options.Size === "M" && s.options.Color === "White")?.quantity).toBe(5);
  });

  it("resolves available qty from all selected axes", () => {
    expect(getAvailableQuantity({ quantity: 7, variants: matrix }, { Size: "S", Color: "Navy" })).toBe(4);
    expect(getAvailableQuantity({ quantity: 7, variants: matrix }, { Size: "M", Color: "Navy" })).toBe(0);
  });

  it("never decrements made-to-order stock helpers at the SKU layer when tracking is MTO", () => {
    expect(
      getAvailableQuantity(
        { quantity: 7, variants: matrix, inventoryTracking: "made_to_order" },
        { Size: "S", Color: "Navy" }
      )
    ).toBe(99);
  });

  it("sums SKU rows rather than Size qty + Color qty", () => {
    expect(sumOptionQuantities(matrix)).toBe(7);
  });

  it("returns null when decrementing a sold-out combination", () => {
    expect(decrementOptionQuantity(matrix, { Size: "M", Color: "Navy" }, 1)).toBeNull();
  });

  it("uses SKU price override at checkout", () => {
    expect(getSkuPriceCents({ priceCents: 2000, variants: matrix }, { Size: "S", Color: "Navy" })).toBe(2000);
    const priced = {
      ...matrix,
      skus: matrix.skus.map((s) =>
        s.options.Size === "S" && s.options.Color === "Navy" ? { ...s, priceCents: 2800 } : s
      ),
    };
    expect(getSkuPriceCents({ priceCents: 2000, variants: priced }, { Size: "S", Color: "Navy" })).toBe(2800);
  });
});

describe("browsePriceLabel", () => {
  it("uses listing price when SKU prices match", () => {
    expect(
      browsePriceLabel(2000, {
        axes: [{ name: "Size", values: ["S"] }],
        skus: [{ options: { Size: "S" }, quantity: 1 }],
      })
    ).toEqual({ cents: 2000, from: false });
  });

  it("shows from $X when SKU overrides differ", () => {
    expect(
      browsePriceLabel(2000, {
        axes: [{ name: "Size", values: ["S", "M"] }],
        skus: [
          { options: { Size: "S" }, quantity: 1, priceCents: 2800 },
          { options: { Size: "M" }, quantity: 1, priceCents: 3200 },
        ],
      })
    ).toEqual({ cents: 2800, from: true });
  });
});
