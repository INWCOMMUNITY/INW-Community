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
    expect(hydrated.variants[0]?.priceCents).toBe(1250);
    expect(hydrated.variants[0]?.options).toEqual({ Color: "Red", Size: "S" });
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
