import { describe, expect, it } from "vitest";
import { hydrateEtsyCandidateWithInventory, type EtsyImportCandidate } from "./import-discovery";

const base: EtsyImportCandidate = {
  etsyListingId: "111",
  title: "Demo",
  description: "Desc",
  state: "active",
  supported: false,
  unsupportedReason: "pending",
  priceCents: 1200,
  quantity: 1,
  sku: null,
  imageUrl: null,
  photos: [],
  recommendedStockMode: null,
  variants: [],
  axes: [],
  etsyWhoMade: null,
  etsyWhenMade: null,
  etsyIsSupply: null,
  etsyTaxonomyId: null,
};

describe("hydrateEtsyCandidateWithInventory", () => {
  it("builds option axes and variant offerings from inventory products", () => {
    const hydrated = hydrateEtsyCandidateWithInventory(base, {
      products: [
        {
          product_id: 1,
          sku: "RED-S",
          property_values: [
            { property_name: "Color", values: ["Red"] },
            { property_name: "Size", values: ["S"] },
          ],
          offerings: [
            {
              offering_id: 10,
              quantity: 3,
              is_enabled: true,
              price: { amount: 1250, divisor: 100 },
            },
          ],
        },
        {
          product_id: 2,
          sku: "BLUE-M",
          property_values: [
            { property_name: "Color", values: ["Blue"] },
            { property_name: "Size", values: ["M"] },
          ],
          offerings: [
            {
              offering_id: 11,
              quantity: 2,
              is_enabled: true,
              price: { amount: 1500, divisor: 100 },
            },
          ],
        },
      ],
    });

    expect(hydrated.supported).toBe(true);
    expect(hydrated.variants).toHaveLength(2);
    expect(hydrated.axes.map((a) => a.name).sort()).toEqual(["Color", "Size"]);
    expect(hydrated.quantity).toBe(5);
    expect(hydrated.sharedQuantity).toBe(false);
    expect(hydrated.quantitiesVary).toBe(true);
    expect(hydrated.pricesVary).toBe(true);
    expect(hydrated.variants[0]?.priceCents).toBe(1250);
    expect(hydrated.variants[0]?.options).toEqual({ Color: "Red", Size: "S" });
  });

  it("keeps one shared quantity when Etsy prices and quantities do not vary", () => {
    const colors = ["Black", "Blue", "Brown"];
    let offeringId = 1;
    const products = colors.flatMap((primary) =>
      colors.map((secondary) => ({
        product_id: offeringId,
        sku: "PHOTO",
        property_values: [
          { property_name: "Primary color", values: [primary] },
          { property_name: "Secondary color", values: [secondary] },
        ],
        offerings: [
          {
            offering_id: offeringId++,
            quantity: 25,
            is_enabled: true,
            price: { amount: 4000, divisor: 100 },
          },
        ],
      }))
    );
    const hydrated = hydrateEtsyCandidateWithInventory(base, {
      products,
      price_on_property: [],
      quantity_on_property: [],
      sku_on_property: [],
    });
    expect(hydrated.supported).toBe(true);
    expect(hydrated.variants).toHaveLength(9);
    expect(hydrated.quantity).toBe(25);
    expect(hydrated.sharedQuantity).toBe(true);
    expect(hydrated.quantitiesVary).toBe(false);
    expect(hydrated.pricesVary).toBe(false);
    expect(hydrated.skusVary).toBe(false);
    expect(hydrated.variants.every((variant) => variant.quantity === 25)).toBe(true);
    expect(hydrated.variants.every((variant) => variant.priceCents === 4000)).toBe(true);
    expect(hydrated.axes.map((axis) => axis.name).sort()).toEqual([
      "Primary color",
      "Secondary color",
    ]);
  });

  it("sums per-combination quantities when Etsy quantity_on_property is set", () => {
    const hydrated = hydrateEtsyCandidateWithInventory(base, {
      products: [
        {
          product_id: 1,
          sku: "BLK",
          property_values: [{ property_name: "Primary color", values: ["Black"] }],
          offerings: [
            { offering_id: 10, quantity: 4, is_enabled: true, price: { amount: 1000, divisor: 100 } },
          ],
        },
        {
          product_id: 2,
          sku: "BLU",
          property_values: [{ property_name: "Primary color", values: ["Blue"] }],
          offerings: [
            { offering_id: 11, quantity: 6, is_enabled: true, price: { amount: 1800, divisor: 100 } },
          ],
        },
      ],
      price_on_property: [200],
      quantity_on_property: [200],
      sku_on_property: [200],
    });
    expect(hydrated.quantity).toBe(10);
    expect(hydrated.sharedQuantity).toBe(false);
    expect(hydrated.quantitiesVary).toBe(true);
    expect(hydrated.pricesVary).toBe(true);
    expect(hydrated.skusVary).toBe(true);
    expect(hydrated.variants.map((variant) => variant.quantity)).toEqual([4, 6]);
  });

  it("rejects inventory with more than three axes", () => {
    const hydrated = hydrateEtsyCandidateWithInventory(base, {
      products: [
        {
          product_id: 1,
          offerings: [{ offering_id: 9, quantity: 1, price: 10 }],
          property_values: [
            { property_name: "A", values: ["1"] },
            { property_name: "B", values: ["1"] },
            { property_name: "C", values: ["1"] },
            { property_name: "D", values: ["1"] },
          ],
        },
      ],
    });
    expect(hydrated.supported).toBe(false);
    expect(hydrated.unsupportedReason).toMatch(/3 variation axes/i);
  });
});
