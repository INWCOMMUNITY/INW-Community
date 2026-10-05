import { describe, expect, it } from "vitest";
import {
  buildEtsyInventoryProductsPayload,
  correlateEtsyProductsToStoreVariants,
  inventoryHasDeprecatedEtsyProperties,
  matchEtsyTaxonomyProperty,
  parseStoreVariantOptions,
  pickEtsyVariationPropertyId,
  sanitizeDeprecatedEtsyInventoryProperties,
  toEtsyInventoryPutBody,
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

  it("requires every combination when three axes are exported", () => {
    const full = ["Red", "Blue"].flatMap((color) =>
      ["Small", "Large"].flatMap((size) =>
        ["Wool", "Cotton"].map((material) => ({
          id: `${color}-${size}-${material}`,
          options: { "Primary color": color, Size: size, Material: material },
          priceCents: 1500,
          sku: null,
        }))
      )
    );
    expect(validateEtsyExportVariants({ variants: full }).ok).toBe(true);
    const missingOne = full.slice(1);
    const result = validateEtsyExportVariants({ variants: missingOne });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/every combination/i);
  });
});

describe("matchEtsyTaxonomyProperty", () => {
  const properties = [
    { property_id: 200, name: "Color", display_name: "Color" },
    { property_id: 513, name: "Primary color", display_name: "Primary color" },
    { property_id: 100, name: "Size", display_name: "Size" },
    { property_id: 507, name: "Material", display_name: "Materials" },
    { property_id: 9, name: "S", display_name: "S" },
  ];

  it("gives Primary color, Size, and Materials three different properties", () => {
    const used = new Set<number>();
    const color = matchEtsyTaxonomyProperty("Primary color", properties, used);
    expect(color?.property_id).toBe(513);
    used.add(513);
    const material = matchEtsyTaxonomyProperty("Materials", properties, used);
    expect(material?.property_id).toBe(507);
    used.add(507);
    const size = matchEtsyTaxonomyProperty("Size", properties, used);
    expect(size).toBeNull();
  });
});

describe("pickEtsyVariationPropertyId", () => {
  it("rejects deprecated Size property 100 and uses custom 513", () => {
    const used = new Set<number>();
    const size = pickEtsyVariationPropertyId({
      axisName: "Size",
      taxonomyPropertyId: 100,
      taxonomyScaleId: 327,
      usedPropertyIds: used,
    });
    expect(size.propertyId).toBe(513);
    expect(size.source).toBe("custom");
    used.add(size.propertyId);

    const color = pickEtsyVariationPropertyId({
      axisName: "Color",
      taxonomyPropertyId: null,
      usedPropertyIds: used,
    });
    expect(color.propertyId).toBe(200);
    expect(color.source).toBe("fallback");
  });

  it("keeps non-deprecated taxonomy property ids", () => {
    const picked = pickEtsyVariationPropertyId({
      axisName: "Size",
      taxonomyPropertyId: 148789511779,
      taxonomyScaleId: 152,
      usedPropertyIds: new Set(),
    });
    expect(picked).toEqual({
      propertyId: 148789511779,
      scaleId: 152,
      source: "taxonomy",
    });
  });
});

describe("sanitizeDeprecatedEtsyInventoryProperties", () => {
  it("rewrites Size property 100 to custom 513 and clears value ids", () => {
    const sanitized = sanitizeDeprecatedEtsyInventoryProperties({
      products: [
        {
          sku: "a",
          property_values: [
            {
              property_id: 100,
              property_name: "Size",
              values: ["M"],
              value_ids: [1],
              scale_id: 327,
            },
            {
              property_id: 200,
              property_name: "Color",
              values: ["Red"],
              value_ids: [2],
            },
          ],
        },
      ],
      price_on_property: [100, 200],
      quantity_on_property: [100],
      sku_on_property: [],
    });
    expect(sanitized.rewritten).toBe(true);
    expect(sanitized.products[0]!.property_values![0]).toMatchObject({
      property_id: 513,
      property_name: "Size",
      values: ["M"],
      value_ids: [],
      scale_id: null,
    });
    expect(sanitized.products[0]!.property_values![1]!.property_id).toBe(200);
    expect(sanitized.price_on_property).toEqual([513, 200]);
    expect(sanitized.quantity_on_property).toEqual([513]);
    expect(inventoryHasDeprecatedEtsyProperties(sanitized.products)).toBe(false);
  });
});

describe("toEtsyInventoryPutBody", () => {
  it("turns an echo GET with property 100 and money prices into a legal PUT", () => {
    const body = toEtsyInventoryPutBody({
      products: [
        {
          product_id: 10,
          sku: "sr",
          is_deleted: false,
          property_values: [
            {
              property_id: 100,
              property_name: "Size",
              values: ["Small"],
              value_ids: [9],
              scale_id: 327,
            },
            {
              property_id: 200,
              property_name: "Color",
              values: ["Red"],
              value_ids: [2],
            },
          ],
          offerings: [
            {
              offering_id: 20,
              is_deleted: false,
              quantity: 3,
              is_enabled: true,
              readiness_state_id: 99,
              price: { amount: 1000, divisor: 100 },
            },
          ],
        },
      ],
      price_on_property: [100, 200],
      quantity_on_property: [100],
      sku_on_property: [],
    });

    expect(body.price_on_property).toEqual([513, 200]);
    expect(body.quantity_on_property).toEqual([513]);
    expect(body.products).toHaveLength(1);
    expect(body.products[0]).not.toHaveProperty("product_id");
    expect(body.products[0]!.offerings[0]).not.toHaveProperty("offering_id");
    expect(body.products[0]!.offerings[0]).toEqual({
      price: 10,
      quantity: 3,
      is_enabled: true,
      readiness_state_id: 99,
    });
    expect(body.products[0]!.property_values[0]).toEqual({
      property_id: 513,
      property_name: "Size",
      values: ["Small"],
      value_ids: [],
    });
    expect(body.products[0]!.property_values[1]).toMatchObject({
      property_id: 200,
      values: ["Red"],
      value_ids: [2],
    });
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
      ["Size", { propertyId: 513, scaleId: null }],
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
    expect(built.products[0]!.property_values[0]!.property_id).toBe(513);
    expect(built.products[0]!.offerings[0]!.quantity).toBe(3);
    expect(built.products[1]!.offerings[0]!.quantity).toBe(6);
    expect(built.products[0]!.offerings[0]!.price).toBe(10);
    expect(built.quantity_on_property).toEqual([513, 200]);
    expect(built.price_on_property).toEqual([513, 200]);

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

  it("repairs empty on_property arrays when rewriting a multi-product inventory GET", () => {
    const body = toEtsyInventoryPutBody({
      products: [
        {
          product_id: 1,
          sku: "",
          property_values: [
            { property_id: 513, property_name: "Size", values: ["Small"], value_ids: [] },
            { property_id: 507, property_name: "Materials", values: ["Wool"], value_ids: [] },
            { property_id: 200, property_name: "Primary color", values: ["Red"], value_ids: [] },
          ],
          offerings: [{ offering_id: 11, price: 5, quantity: 2, is_enabled: true }],
        },
        {
          product_id: 2,
          sku: "",
          property_values: [
            { property_id: 513, property_name: "Size", values: ["Medium"], value_ids: [] },
            { property_id: 507, property_name: "Materials", values: ["Cotton"], value_ids: [] },
            { property_id: 200, property_name: "Primary color", values: ["Blue"], value_ids: [] },
          ],
          offerings: [{ offering_id: 22, price: 5, quantity: 2, is_enabled: true }],
        },
      ],
      price_on_property: [],
      quantity_on_property: [],
      sku_on_property: [],
    });
    expect(body.price_on_property.sort()).toEqual([200, 507, 513]);
    expect(body.quantity_on_property.sort()).toEqual([200, 507, 513]);
    expect(body.products).toHaveLength(2);
    expect(body.products.every((p) => p.offerings[0]?.quantity === 2)).toBe(true);
  });

  it("keeps per-combination price and quantity on Etsy when every row matches", () => {
    const variants = [
      {
        id: "v1",
        options: { Size: "Small", Materials: "Wool", "Primary color": "Red" },
        priceCents: 1500,
        sku: null,
        inventory: { mode: "TRACKED_FINITE" as const, onHand: 10, reserved: 0 },
      },
      {
        id: "v2",
        options: { Size: "Medium", Materials: "Wool", "Primary color": "Blue" },
        priceCents: 1500,
        sku: null,
        inventory: { mode: "TRACKED_FINITE" as const, onHand: 10, reserved: 0 },
      },
    ];
    const axisNames = ["Materials", "Primary color", "Size"];
    const propertyMap = new Map([
      ["Materials", { propertyId: 507, scaleId: null }],
      ["Primary color", { propertyId: 200, scaleId: null }],
      ["Size", { propertyId: 513, scaleId: null }],
    ]);
    const built = buildEtsyInventoryProductsPayload({
      variants,
      inventoryTracking: "tracked",
      axisNames,
      propertyMap,
      readinessStateId: 99,
    });
    expect(built.price_on_property).toEqual([507, 200, 513]);
    expect(built.quantity_on_property).toEqual([507, 200, 513]);
    expect(built.sku_on_property).toEqual([]);
  });

  it("correlates when Etsy renames axes but keeps the option values", () => {
    const corr = correlateEtsyProductsToStoreVariants({
      requested: [{ storeVariantId: "v1", options: { Size: "Small", Color: "Red" } }],
      remote: [
        {
          product_id: 55,
          sku: "sr",
          property_values: [
            { property_id: 513, property_name: "Custom Property", values: ["Small"], value_ids: [8] },
            { property_id: 200, property_name: "Primary color", values: ["Red"], value_ids: [3] },
          ],
          offerings: [{ offering_id: 66, quantity: 2, is_enabled: true }],
        },
      ],
    });
    expect(corr.ok).toBe(true);
    if (corr.ok) {
      expect(corr.pairs[0]).toMatchObject({
        storeVariantId: "v1",
        etsyProductId: "55",
        etsyOfferingId: "66",
      });
    }
  });

  it("does not persist deprecated property 100 on a matched product", () => {
    const corr = correlateEtsyProductsToStoreVariants({
      requested: [{ storeVariantId: "v1", options: { Size: "Small" } }],
      remote: [
        {
          product_id: 55,
          property_values: [
            { property_id: 100, property_name: "Size", values: ["Small"], value_ids: [9] },
          ],
          offerings: [{ offering_id: 66, quantity: 1, is_enabled: true }],
        },
      ],
    });
    expect(corr.ok).toBe(true);
    if (corr.ok) {
      expect(corr.pairs[0]!.propertyValuesJson?.[0]).toMatchObject({
        property_id: 513,
        property_name: "Size",
        values: ["Small"],
        value_ids: [],
      });
    }
  });
});
