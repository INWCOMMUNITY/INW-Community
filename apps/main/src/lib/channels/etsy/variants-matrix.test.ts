import { describe, expect, it } from "vitest";
import {
  etsyInventoryToVariants,
  etsyInventoryWritePath,
  etsyOnPropertyFields,
} from "./variants";
import { MAX_ETSY_AXES } from "@/lib/listing-variant-matrix";
import { expectedComboSkuCount, shouldRebuildEtsyComboInventory } from "../combo-sync";
import { validateVariantLimits } from "../variant-sync";

describe("etsyInventoryToVariants", () => {
  it("reads every property_values entry per product", () => {
    const matrix = etsyInventoryToVariants([
      {
        sku: "NVY-S",
        property_values: [
          { property_name: "Size", values: ["S"] },
          { property_name: "Color", values: ["Navy"] },
        ],
        offerings: [{ quantity: 4, price: { amount: 2000, divisor: 100 } }],
      },
      {
        sku: "WHT-M",
        property_values: [
          { property_name: "Size", values: ["M"] },
          { property_name: "Color", values: ["White"] },
        ],
        offerings: [{ quantity: 1 }],
      },
    ]);
    expect(matrix?.skus[0].priceCents).toBe(2000);
    expect(matrix?.skus[0].options).toEqual({ Size: "S", Color: "Navy" });
    expect(matrix?.axes).toHaveLength(2);
  });

  it("imports a third variation property", () => {
    const matrix = etsyInventoryToVariants([
      {
        property_values: [
          { property_name: "Size", values: ["S"] },
          { property_name: "Color", values: ["Navy"] },
          { property_name: "Fit", values: ["Slim"] },
        ],
        offerings: [{ quantity: 1, price: { amount: 1500, divisor: 100 } }],
      },
    ]);
    expect(matrix?.axes.map((a) => a.name)).toEqual(["Size", "Color", "Fit"]);
    expect(matrix?.skus[0].priceCents).toBe(1500);
  });

  it("allows publishing a third Etsy axis", () => {
    expect(
      validateVariantLimits("etsy", {
        axes: [
          { name: "Size", values: ["S"] },
          { name: "Color", values: ["Navy"] },
          { name: "Fit", values: ["Slim"] },
        ],
        skus: [{ options: { Size: "S", Color: "Navy", Fit: "Slim" }, quantity: 1 }],
      })
    ).toBeNull();
    expect(MAX_ETSY_AXES).toBe(3);
  });
});

describe("etsy inventory writes", () => {
  it("opts in to three variations on inventory PUT", () => {
    expect(etsyInventoryWritePath("123")).toBe(
      "/listings/123/inventory?max_variations_supported=3"
    );
  });

  it("sends *_on_property as none or all three properties, never two", () => {
    const products = [
      {
        property_values: [
          { property_id: 1, property_name: "Size" },
          { property_id: 2, property_name: "Color" },
          { property_id: 3, property_name: "Fit" },
        ],
      },
    ];
    const threeAxis = {
      axes: [
        { name: "Size", values: ["S"] },
        { name: "Color", values: ["Navy"] },
        { name: "Fit", values: ["Slim"] },
      ],
      skus: [{ options: { Size: "S", Color: "Navy", Fit: "Slim" }, quantity: 1, priceCents: 1500 }],
      pricesVary: true,
      quantitiesVary: true,
      skusVary: false,
    };
    const on = etsyOnPropertyFields(threeAxis, products);
    expect(on.price_on_property).toEqual([1, 2, 3]);
    expect(on.quantity_on_property).toEqual([1, 2, 3]);
    expect(on.sku_on_property).toEqual([]);
    expect(on.price_on_property).not.toHaveLength(2);
    expect(on.quantity_on_property).not.toHaveLength(2);

    const none = etsyOnPropertyFields(
      { ...threeAxis, pricesVary: false, quantitiesVary: false, skusVary: false, skus: [{ options: { Size: "S", Color: "Navy", Fit: "Slim" }, quantity: 1 }] },
      products
    );
    expect(none.price_on_property).toEqual([]);
    expect(none.quantity_on_property).toEqual([]);
  });
});

describe("Etsy combo rebuild", () => {
  it("rebuilds a Color-only listing when INW has Size × Color SKUs", () => {
    const matrix = {
      axes: [
        { name: "Size", values: ["S", "M"] },
        { name: "Color", values: ["Navy", "White"] },
      ],
      skus: [
        { options: { Size: "S", Color: "Navy" }, quantity: 2 },
        { options: { Size: "S", Color: "White" }, quantity: 1 },
        { options: { Size: "M", Color: "Navy" }, quantity: 3 },
        { options: { Size: "M", Color: "White" }, quantity: 0 },
      ],
    };
    expect(shouldRebuildEtsyComboInventory(matrix, 2)).toBe(true);
    expect(expectedComboSkuCount(matrix)).toBe(4);
    expect(expectedComboSkuCount(matrix)).toBe(matrix.skus.length);
  });
});
