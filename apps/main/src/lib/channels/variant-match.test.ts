import { describe, it, expect } from "vitest";
import type { VariantMatrix } from "@/lib/listing-variant-matrix";
import {
  optionValueSetKey,
  variantOptionsMatch,
  matchInwSkuRow,
  matchRemoteRow,
} from "./variant-match";

function matrix(): VariantMatrix {
  return {
    axes: [
      { name: "Size", values: ["S", "L"] },
      { name: "Color", values: ["Brown", "Blue"] },
    ],
    skus: [
      { options: { Size: "S", Color: "Brown" }, quantity: 3, priceCents: 1500, sku: "ABC-S-BR" },
      { options: { Size: "L", Color: "Brown" }, quantity: 2, priceCents: 1000, sku: "ABC-L-BR" },
      { options: { Size: "S", Color: "Blue" }, quantity: 1, priceCents: 2000, sku: "ABC-S-BL" },
      { options: { Size: "L", Color: "Blue" }, quantity: 0, priceCents: 2000, sku: "ABC-L-BL" },
    ],
  };
}

describe("optionValueSetKey", () => {
  it("is order- and name-independent, case-insensitive", () => {
    expect(optionValueSetKey({ Size: "L", Color: "Brown" })).toBe(
      optionValueSetKey({ Color: "brown", Foo: "l" })
    );
  });
  it("ignores empty values and blanks", () => {
    expect(optionValueSetKey({ Size: "  ", Color: "Brown" })).toBe(optionValueSetKey({ x: "brown" }));
  });
  it("returns empty for empty input", () => {
    expect(optionValueSetKey(null)).toBe("");
    expect(optionValueSetKey({})).toBe("");
  });
});

describe("variantOptionsMatch", () => {
  it("matches across different axis names (Wix Option vs Size/Color)", () => {
    expect(variantOptionsMatch({ Size: "L", Color: "Brown" }, { Option: "Brown", Other: "L" })).toBe(true);
  });
  it("does not match different combinations", () => {
    expect(variantOptionsMatch({ Size: "L", Color: "Brown" }, { Size: "S", Color: "Brown" })).toBe(false);
  });
  it("never matches empty selections", () => {
    expect(variantOptionsMatch({}, { Size: "L" })).toBe(false);
  });
});

describe("matchInwSkuRow", () => {
  it("matches by SKU code first", () => {
    const res = matchInwSkuRow(matrix(), { sku: "abc-l-br", options: { Wrong: "value" } });
    expect(res.quality).toBe("sku");
    expect(res.row?.options).toEqual({ Size: "L", Color: "Brown" });
  });
  it("matches by option values when SKU differs (axis-name drift)", () => {
    const res = matchInwSkuRow(matrix(), { sku: null, options: { Option: "brown", Size2: "l" } });
    expect(res.quality).toBe("values");
    expect(res.row?.priceCents).toBe(1000);
  });
  it("returns none when nothing matches (no positional by default)", () => {
    const res = matchInwSkuRow(matrix(), { options: { Size: "XL", Color: "Green" } });
    expect(res.quality).toBe("none");
    expect(res.row).toBeNull();
  });
  it("positional only fires for single-combination products", () => {
    const single: VariantMatrix = {
      axes: [{ name: "Size", values: ["One"] }],
      skus: [{ options: { Size: "One" }, quantity: 5, priceCents: 999 }],
    };
    const res = matchInwSkuRow(single, { options: { Whatever: "mismatch" } }, { allowPositional: true });
    expect(res.quality).toBe("positional");
    expect(res.row?.priceCents).toBe(999);
  });
});

describe("matchRemoteRow", () => {
  it("finds the remote row for an INW sku by values", () => {
    const remoteRows = [
      { sku: "x", options: { Option: "Blue", Size: "S" } },
      { sku: "y", options: { Option: "Brown", Size: "L" } },
    ];
    const res = matchRemoteRow(remoteRows, {
      options: { Size: "L", Color: "Brown" },
      quantity: 0,
    });
    expect(res.quality).toBe("values");
    expect(res.row?.sku).toBe("y");
  });
});
