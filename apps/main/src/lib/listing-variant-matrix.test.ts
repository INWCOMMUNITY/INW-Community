import { describe, expect, it } from "vitest";
import {
  applyLiveInventoryQuantitiesToMatrix,
  applyRemoteVariantPricesToMatrix,
  browsePriceLabel,
  decrementMatrixSku,
  fillMissingAlphanumericComboSkus,
  incrementMatrixSku,
  listingGalleryPhotoChoices,
  minSkuPriceCents,
  normalizeVariantMatrix,
  rebuildMatrixFromAxes,
  serializeVariantMatrix,
  sumMatrixQuantities,
  validateVariantMatrixForSave,
  type VariantMatrix,
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

  it("restores Size from combination rows when axes only list Color", () => {
    const matrix = normalizeVariantMatrix({
      axes: [{ name: "Color", values: ["Navy", "White"] }],
      skus: [
        { options: { Size: "S", Color: "Navy" }, quantity: 2 },
        { options: { Size: "M", Color: "Navy" }, quantity: 1 },
        { options: { Size: "S", Color: "White" }, quantity: 4 },
      ],
    });
    expect(matrix?.axes.map((a) => a.name)).toEqual(["Color", "Size"]);
    expect([...(matrix?.axes.find((a) => a.name === "Size")?.values ?? [])].sort()).toEqual(["M", "S"]);
    expect(matrix?.skus.find((s) => s.options.Size === "S" && s.options.Color === "Navy")?.quantity).toBe(2);
    expect(matrix?.skus.find((s) => s.options.Size === "M" && s.options.Color === "Navy")?.quantity).toBe(1);
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

  it("clears SKU photos when the image axis no longer has a matching link", () => {
    const rebuilt = rebuildMatrixFromAxes(
      [
        { name: "Size", values: ["S"] },
        { name: "Color", values: ["Navy"], photosByValue: {} },
      ],
      [
        {
          options: { Size: "S", Color: "Navy" },
          quantity: 1,
          photos: ["https://cdn.example/stale.jpg"],
        },
      ],
      { imageAxis: "Color" }
    );
    expect(rebuilt.skus[0].photos).toBeUndefined();
  });

  it("keeps blob gallery URLs for Manage photos", () => {
    expect(
      listingGalleryPhotoChoices([
        "https://cdn.example/navy.jpg",
        "blob:http://localhost:3000/abc",
        "  ",
        "data:image/png;base64,aaa",
      ])
    ).toEqual([
      "https://cdn.example/navy.jpg",
      "blob:http://localhost:3000/abc",
      "data:image/png;base64,aaa",
    ]);
  });

  it("keeps applied photo links when a discarded manage draft is empty", () => {
    const applied = normalizeVariantMatrix({
      axes: [
        { name: "Size", values: ["S"] },
        {
          name: "Color",
          values: ["Navy"],
          photosByValue: { Navy: ["https://cdn.example/navy.jpg"] },
        },
      ],
      imageAxis: "Color",
      skus: [{ options: { Size: "S", Color: "Navy" }, quantity: 1 }],
    });
    const discardedDraft: unknown[] = [];
    expect(discardedDraft).toEqual([]);
    expect(applied?.axes.find((a) => a.name === "Color")?.photosByValue?.Navy).toEqual([
      "https://cdn.example/navy.jpg",
    ]);
    expect(applied?.skus[0].photos).toEqual(["https://cdn.example/navy.jpg"]);
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

describe("fillMissingAlphanumericComboSkus", () => {
  it("stamps alphanumeric SKUs onto combo rows that have none", () => {
    const filled = fillMissingAlphanumericComboSkus(
      {
        axes: [{ name: "Color", values: ["Purple", "Red"] }],
        skus: [
          { options: { Color: "Purple" }, quantity: 2 },
          { options: { Color: "Red" }, quantity: 1, sku: "KEEPME" },
        ],
      },
      "cmt7vumcl000dxjujvgwe8dob"
    );
    expect(filled.skus[0].sku).toBe("cmt7vumcl000dxjujvgwe8dobPurple");
    expect(filled.skus[1].sku).toBe("KEEPME");
    expect(filled.skus[0].sku).not.toContain("-");
  });
});

describe("applyLiveInventoryQuantitiesToMatrix", () => {
  const base = (): VariantMatrix =>
    normalizeVariantMatrix({
      axes: [{ name: "Size", values: ["S", "M", "L"] }],
      skus: [
        { options: { Size: "S" }, quantity: 2, sku: "SKU-S" },
        { options: { Size: "M" }, quantity: 3, sku: "SKU-M" },
        { options: { Size: "L" }, quantity: 4, sku: "SKU-L" },
      ],
    })!;

  it("overwrites quantities matched by SKU", () => {
    const next = applyLiveInventoryQuantitiesToMatrix(base(), [
      { sku: "SKU-S", options: { Size: "S" }, quantity: 0 },
      { sku: "SKU-M", options: { Size: "M" }, quantity: 5 },
      { sku: "SKU-L", options: { Size: "L" }, quantity: 4 },
    ]);
    expect(next.skus.map((s) => s.quantity)).toEqual([0, 5, 4]);
    expect(sumMatrixQuantities(next)).toBe(9);
  });

  it("falls back to options match when SKU differs", () => {
    const next = applyLiveInventoryQuantitiesToMatrix(base(), [
      { sku: "OTHER", options: { Size: "M" }, quantity: 9 },
    ]);
    expect(next.skus.map((s) => s.quantity)).toEqual([2, 9, 4]);
  });

  it("preserves rows with no matching live read (never zeroes on missing read)", () => {
    const next = applyLiveInventoryQuantitiesToMatrix(base(), [
      { sku: "SKU-S", options: { Size: "S" }, quantity: 1 },
    ]);
    expect(next.skus.map((s) => s.quantity)).toEqual([1, 3, 4]);
  });

  it("ignores non-finite quantities and treats empty input as a no-op", () => {
    const matrix = base();
    expect(applyLiveInventoryQuantitiesToMatrix(matrix, [])).toBe(matrix);
    const next = applyLiveInventoryQuantitiesToMatrix(matrix, [
      { sku: "SKU-S", options: { Size: "S" }, quantity: Number.NaN },
    ]);
    expect(next.skus.map((s) => s.quantity)).toEqual([2, 3, 4]);
  });

  it("keeps axes/options/skus intact and clamps negatives", () => {
    const next = applyLiveInventoryQuantitiesToMatrix(base(), [
      { sku: "SKU-S", options: { Size: "S" }, quantity: -5 },
    ]);
    expect(next.axes).toEqual(base().axes);
    expect(next.skus[0].sku).toBe("SKU-S");
    expect(next.skus[0].options).toEqual({ Size: "S" });
    expect(next.skus[0].quantity).toBe(0);
  });
});

describe("applyRemoteVariantPricesToMatrix", () => {
  const base = (): VariantMatrix =>
    normalizeVariantMatrix({
      axes: [{ name: "Color", values: ["Red", "Blue", "Green"] }],
      skus: [
        { options: { Color: "Red" }, quantity: 2, sku: "SKU-R", priceCents: 2500 },
        { options: { Color: "Blue" }, quantity: 3, sku: "SKU-B", priceCents: 2500 },
        { options: { Color: "Green" }, quantity: 4, sku: "SKU-G", priceCents: 2500 },
      ],
    })!;

  it("overwrites only the edited SKU price and never collapses the others", () => {
    const next = applyRemoteVariantPricesToMatrix(base(), [
      { sku: "SKU-R", options: { Color: "Red" }, priceCents: 100 },
    ]);
    expect(next.skus.map((s) => s.priceCents)).toEqual([100, 2500, 2500]);
    // Quantities and structure are preserved.
    expect(next.skus.map((s) => s.quantity)).toEqual([2, 3, 4]);
    expect(next.axes).toEqual(base().axes);
    // Listing floor reflects the new minimum, not a collapse of every variation.
    expect(minSkuPriceCents(next, 2500)).toBe(100);
  });

  it("falls back to options match when the SKU differs", () => {
    const next = applyRemoteVariantPricesToMatrix(base(), [
      { sku: "OTHER", options: { Color: "Blue" }, priceCents: 999 },
    ]);
    expect(next.skus.map((s) => s.priceCents)).toEqual([2500, 999, 2500]);
  });

  it("keeps existing prices for rows with no matching remote read", () => {
    const next = applyRemoteVariantPricesToMatrix(base(), [
      { sku: "SKU-R", options: { Color: "Red" }, priceCents: 100 },
    ]);
    expect(next.skus[1].priceCents).toBe(2500);
    expect(next.skus[2].priceCents).toBe(2500);
  });

  it("ignores non-finite / non-positive prices and treats empty input as a no-op", () => {
    const matrix = base();
    expect(applyRemoteVariantPricesToMatrix(matrix, [])).toBe(matrix);
    const next = applyRemoteVariantPricesToMatrix(matrix, [
      { sku: "SKU-R", options: { Color: "Red" }, priceCents: Number.NaN },
      { sku: "SKU-B", options: { Color: "Blue" }, priceCents: 0 },
      { sku: "SKU-G", options: { Color: "Green" }, priceCents: -10 },
    ]);
    expect(next).toBe(matrix);
  });

  it("marks pricesVary so serialization preserves the learned per-SKU prices", () => {
    const next = applyRemoteVariantPricesToMatrix(base(), [
      { sku: "SKU-R", options: { Color: "Red" }, priceCents: 100 },
    ]);
    const serialized = serializeVariantMatrix(next);
    expect(serialized.pricesVary).toBe(true);
    expect(serialized.skus.map((s) => s.priceCents)).toEqual([100, 2500, 2500]);
  });
});
