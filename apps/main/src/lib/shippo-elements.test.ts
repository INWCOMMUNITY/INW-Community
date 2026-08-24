import { describe, expect, it } from "vitest";
import { buildOrderDetailsFromOrder, parcelFromOrderItems, type OrderForElements } from "./shippo-elements";

function makeOrder(overrides: Partial<OrderForElements> = {}): OrderForElements {
  return {
    id: "order-1",
    shippingAddress: { street: "1 Main St", city: "Spokane", state: "WA", zip: "99201" },
    buyer: { firstName: "Ada", lastName: "Lovelace" },
    items: [
      {
        quantity: 2,
        priceCentsAtPurchase: 1000,
        storeItem: {
          title: "Mug",
          shippingOption: { weightOz: 8, lengthIn: 10, widthIn: 6, heightIn: 4 },
        },
      },
    ],
    ...overrides,
  };
}

describe("Shippo package from listing options", () => {
  it("uses listing option weight in ounces on line items", () => {
    const details = buildOrderDetailsFromOrder(makeOrder());
    expect(details?.line_items[0]?.unit_weight).toBe("8");
    expect(details?.line_items[0]?.weight_unit).toBe("oz");
    expect(details?.line_items[0]?.quantity).toBe(2);
  });

  it("falls back to 16 oz when the option is incomplete", () => {
    const details = buildOrderDetailsFromOrder(
      makeOrder({
        items: [
          {
            quantity: 1,
            priceCentsAtPurchase: 500,
            storeItem: {
              title: "Mug",
              shippingOption: { weightOz: 8, lengthIn: null, widthIn: 6, heightIn: 4 },
            },
          },
        ],
      })
    );
    expect(details?.line_items[0]?.unit_weight).toBe("16");
  });

  it("sums weight by quantity and takes max dimensions for the starting parcel", () => {
    expect(parcelFromOrderItems(makeOrder())).toEqual({
      weightOz: 16,
      lengthIn: 10,
      widthIn: 6,
      heightIn: 4,
    });
  });
});
