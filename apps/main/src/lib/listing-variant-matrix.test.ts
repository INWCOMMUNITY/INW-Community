import { describe, expect, it } from "vitest";
import {
  applyLiveInventoryQuantitiesToMatrix,
  applyRemoteVariantPricesToMatrix,
  browsePriceLabel,
  decrementMatrixSku,
  fillMissingAlphanumericComboSkus,
  incrementMatrixSku,
  inboundListingPriceCents,
  listingGalleryPhotoChoices,
  matrixHasKnownSkuPrices,
  mergeIncomingVariantMatrixPreservingUnknownPrices,
  minSkuPriceCents,
  remoteSkuPriceLooksLikeListingMinFill,
  stripSkuPricesFromMatrix,
  isVariantPriceDraftInput,
  isVariantQtyDraftInput,
  formatVariantPriceCents,
  moneyInputToEditable,
  moneyInputToIdle,
  sanitizePriceDraftInput,
  sanitizeQtyDraftInput,
  variantPriceCentsToEditable,
  variantPriceDraftToCents,
  variantQtyDraftToNumber,
  variantQtyToEditable,
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

  it("does not materialize eBay listing-min StartPrice onto unpriced fallback SKUs", () => {
    const matrix = normalizeVariantMatrix({
      axes: [
        { name: "Size", values: ["Small", "Large"] },
        { name: "Primary color", values: ["Red", "Green"] },
      ],
      skus: [
        { options: { Size: "Small", "Primary color": "Red" }, quantity: 1, priceCents: 500 },
        { options: { Size: "Large", "Primary color": "Blue" }, quantity: 4, priceCents: 2000 },
        { options: { Size: "Small", "Primary color": "Green" }, quantity: 5 },
        { options: { Size: "Large", "Primary color": "Green" }, quantity: 5 },
      ],
    })!;
    const next = applyRemoteVariantPricesToMatrix(
      matrix,
      [
        { options: { Size: "Small", "Primary color": "Red" }, priceCents: 500 },
        { options: { Size: "Large", "Primary color": "Blue" }, priceCents: 2000 },
        { options: { Size: "Small", "Primary color": "Green" }, priceCents: 500 },
        { options: { Size: "Large", "Primary color": "Green" }, priceCents: 500 },
      ],
      { listingMinCents: 500, inwListingPriceCents: 100 }
    );
    expect(next.skus[0].priceCents).toBe(500);
    expect(next.skus[1].priceCents).toBe(2000);
    expect(next.skus[2].priceCents).toBeUndefined();
    expect(next.skus[3].priceCents).toBeUndefined();
    expect(inboundListingPriceCents(next, 100)).toBe(100);
  });

  it("still applies a real seller price on a previously unpriced SKU", () => {
    const matrix = normalizeVariantMatrix({
      axes: [{ name: "Color", values: ["Green"] }],
      skus: [{ options: { Color: "Green" }, quantity: 5 }],
    })!;
    const next = applyRemoteVariantPricesToMatrix(
      matrix,
      [{ options: { Color: "Green" }, priceCents: 800 }],
      { listingMinCents: 500, inwListingPriceCents: 100 }
    );
    expect(next.skus[0].priceCents).toBe(800);
  });
});

describe("remoteSkuPriceLooksLikeListingMinFill", () => {
  it("skips listing-min fills on unpriced rows and allows distinct INW SKU prices", () => {
    expect(
      remoteSkuPriceLooksLikeListingMinFill({
        inwSkuPriceCents: undefined,
        remotePriceCents: 500,
        listingMinCents: 500,
        inwListingPriceCents: 100,
      })
    ).toBe(true);
    expect(
      remoteSkuPriceLooksLikeListingMinFill({
        inwSkuPriceCents: 500,
        remotePriceCents: 500,
        listingMinCents: 500,
        inwListingPriceCents: 100,
      })
    ).toBe(false);
  });
});

describe("mergeIncomingVariantMatrixPreservingUnknownPrices", () => {
  const pricedInw = (): VariantMatrix =>
    normalizeVariantMatrix({
      axes: [{ name: "Size", values: ["S", "M"] }],
      skus: [
        { options: { Size: "S" }, quantity: 2, priceCents: 1800 },
        { options: { Size: "M" }, quantity: 4, priceCents: 2200 },
      ],
    })!;

  it("keeps INW SKU prices when the remote snapshot has qty but no prices", () => {
    const incoming = normalizeVariantMatrix({
      axes: [{ name: "Size", values: ["S", "M"] }],
      skus: [
        { options: { Size: "S" }, quantity: 9 },
        { options: { Size: "M" }, quantity: 1 },
      ],
    })!;
    const next = mergeIncomingVariantMatrixPreservingUnknownPrices(pricedInw(), incoming);
    expect(next.skus.map((s) => s.quantity)).toEqual([9, 1]);
    expect(next.skus.map((s) => s.priceCents)).toEqual([1800, 2200]);
  });

  it("uses remote prices when they are present", () => {
    const incoming = normalizeVariantMatrix({
      axes: [{ name: "Size", values: ["S", "M"] }],
      skus: [
        { options: { Size: "S" }, quantity: 2, priceCents: 3000 },
        { options: { Size: "M" }, quantity: 4, priceCents: 3100 },
      ],
    })!;
    const next = mergeIncomingVariantMatrixPreservingUnknownPrices(pricedInw(), incoming);
    expect(next.skus.map((s) => s.priceCents)).toEqual([3000, 3100]);
  });

  it("overlays remote prices onto INW qty when the remote matrix has prices but zero stock", () => {
    const incoming = normalizeVariantMatrix({
      axes: [{ name: "Size", values: ["S", "M"] }],
      skus: [
        { options: { Size: "S" }, quantity: 0, priceCents: 3000 },
        { options: { Size: "M" }, quantity: 0, priceCents: 3100 },
      ],
    })!;
    const next = mergeIncomingVariantMatrixPreservingUnknownPrices(pricedInw(), incoming);
    expect(next.skus.map((s) => s.quantity)).toEqual([2, 4]);
    expect(next.skus.map((s) => s.priceCents)).toEqual([3000, 3100]);
  });

  it("reports known SKU prices only when a row has a positive priceCents", () => {
    expect(matrixHasKnownSkuPrices(pricedInw())).toBe(true);
    expect(
      matrixHasKnownSkuPrices({
        axes: [{ name: "Size", values: ["S"] }],
        skus: [{ options: { Size: "S" }, quantity: 1 }],
      })
    ).toBe(false);
  });

  it("preserves INW SKU prices after a qty-only webhook strip", () => {
    const inw = pricedInw();
    const incoming = stripSkuPricesFromMatrix({
      ...inw,
      skus: inw.skus.map((s) => ({ ...s, quantity: s.quantity + 1 })),
    });
    expect(matrixHasKnownSkuPrices(incoming)).toBe(false);
    const next = mergeIncomingVariantMatrixPreservingUnknownPrices(inw, incoming);
    expect(next.skus.map((s) => s.quantity)).toEqual([3, 5]);
    expect(next.skus.map((s) => s.priceCents)).toEqual([1800, 2200]);
  });
});

describe("variant price draft", () => {
  it("lets typing 1 then 18 stay 18 until blur formats cents", () => {
    expect(isVariantPriceDraftInput("1")).toBe(true);
    expect(isVariantPriceDraftInput("18")).toBe(true);
    expect(isVariantPriceDraftInput("1.")).toBe(true);
    expect(isVariantPriceDraftInput("1.00")).toBe(true);
    expect(isVariantPriceDraftInput("1.002")).toBe(false);
    expect(variantPriceDraftToCents("1")).toBe(100);
    expect(variantPriceDraftToCents("18")).toBe(1800);
    expect(variantPriceDraftToCents("1.")).toBeUndefined();
    expect(variantPriceCentsToEditable(100)).toBe("1");
    expect(formatVariantPriceCents(1800)).toBe("18.00");
    expect(sanitizePriceDraftInput("1.008")).toBeNull();
    expect(sanitizePriceDraftInput("$18")).toBe("18");
    expect(moneyInputToEditable("1.00")).toBe("1");
    expect(moneyInputToIdle("18")).toBe("18.00");
  });

  it("keeps quantity as a digit string while typing", () => {
    expect(isVariantQtyDraftInput("")).toBe(true);
    expect(isVariantQtyDraftInput("12")).toBe(true);
    expect(isVariantQtyDraftInput("1.2")).toBe(false);
    expect(sanitizeQtyDraftInput("12 pcs")).toBe("12");
    expect(variantQtyDraftToNumber("")).toBe(0);
    expect(variantQtyDraftToNumber("12")).toBe(12);
    expect(variantQtyToEditable(0)).toBe("");
    expect(variantQtyToEditable(12)).toBe("12");
  });
});
