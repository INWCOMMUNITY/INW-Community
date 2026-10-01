import { describe, expect, it } from "vitest";
import {
  buildEtsyInventoryProductsPayload,
  correlateEtsyProductsToStoreVariants,
  parseStoreVariantOptions,
  validateEtsyExportVariants,
} from "./listing-variants";

describe("parseStoreVariantOptions", () => {
  it("parses object and JSON string options", () => {
    expect(parseStoreVariantOptions({ Size: "M", Color: "Red" })).toEqual({
      Size: "M",
      Color: "Red",
    });
    expect(parseStoreVariantOptions('{"Size":"S"}')).toEqual({ Size: "S" });
    expect(parseStoreVariantOptions({})).toBeNull();
    expect(parseStoreVariantOptions(null)).toBeNull();
  });
});

describe("validateEtsyExportVariants", () => {
  it("allows a single variant without options", () => {
    const result = validateEtsyExportVariants({
      variants: [{ id: "v1", options: null, priceCents: 1000, sku: null }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.multi).toBe(false);
  });

  it("fail-closes multi-variant without option axes", () => {
    const result = validateEtsyExportVariants({
      variants: [
        { id: "v1", options: null, priceCents: 1000, sku: null },
        { id: "v2", options: null, priceCents: 1000, sku: null },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts Size×Color matrix", () => {
    const result = validateEtsyExportVariants({
      variants: [
        { id: "v1", options: { Size: "S", Color: "Red" }, priceCents: 1000, sku: "a" },
        { id: "v2", options: { Size: "M", Color: "Red" }, priceCents: 1200, sku: "b" },
        { id: "v3", options: { Size: "S", Color: "Blue" }, priceCents: 1000, sku: "c" },
        { id: "v4", options: { Size: "M", Color: "Blue" }, priceCents: 1200, sku: "d" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.multi).toBe(true);
      expect(result.axisNames.sort()).toEqual(["Color", "Size"]);
    }
  });
});

describe("buildEtsyInventoryProductsPayload + correlate", () => {
  it("builds one product per combo and correlates by options", () => {
    const variants = [
      {
        id: "v1",
        options: { Size: "S", Color: "Red" },
        priceCents: 1000,
        sku: "sr",
        inventory: { mode: "TRACKED_FINITE", onHand: 3, reserved: 0 },
      },
      {
        id: "v2",
        options: { Size: "M", Color: "Blue" },
        priceCents: 1500,
        sku: "mb",
        inventory: { mode: "TRACKED_FINITE", onHand: 7, reserved: 1 },
      },
    ];
    const axisNames = ["Size", "Color"];
    const propertyMap = new Map([
      ["Size", { propertyId: 100, scaleId: null }],
      ["Color", { propertyId: 200, scaleId: null }],
    ]);
    const built = buildEtsyInventoryProductsPayload({
      variants,
      inventoryTracking: "tracked",
      axisNames,
      propertyMap,
      readinessStateId: 99,
    });
    expect(built.products).toHaveLength(2);
    expect(built.products[0]!.offerings[0]!.quantity).toBe(3);
    expect(built.products[1]!.offerings[0]!.quantity).toBe(6);
    expect(built.products[0]!.offerings[0]!.price).toBe(10);
    expect(built.quantity_on_property.length).toBeGreaterThan(0);
    expect(built.price_on_property.length).toBeGreaterThan(0);

    const remote = built.products.map((p, i) => ({
      product_id: 1000 + i,
      sku: p.sku,
      property_values: p.property_values,
      offerings: [{ offering_id: 2000 + i, quantity: p.offerings[0]!.quantity, is_enabled: true }],
    }));
    const corr = correlateEtsyProductsToStoreVariants({
      requested: [
        { storeVariantId: "v1", options: { Size: "S", Color: "Red" } },
        { storeVariantId: "v2", options: { Size: "M", Color: "Blue" } },
      ],
      remote,
    });
    expect(corr.ok).toBe(true);
    if (corr.ok) {
      expect(corr.pairs).toHaveLength(2);
      expect(corr.pairs.find((p) => p.storeVariantId === "v1")?.etsyOfferingId).toBe("2000");
      expect(corr.pairs.find((p) => p.storeVariantId === "v2")?.etsyProductId).toBe("1001");
    }
  });
});
