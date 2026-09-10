import { describe, expect, it } from "vitest";
import {
  buildOrderDetailsFromOrder,
  collectLabelUrlsFromTransactions,
  parcelFromOrderItems,
  uniqueHttpUrls,
  type OrderForElements,
} from "./shippo-elements";

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

  it("swaps buyer checkout address to seller ship-from on a return label", () => {
    const details = buildOrderDetailsFromOrder(makeOrder(), null, {
      isReturn: true,
      sellerFromAddress: {
        name: "Seller Shop",
        street1: "200 Pine St",
        city: "Spokane",
        state: "WA",
        zip: "99202",
        country: "US",
      },
    });
    expect(details?.address_from?.street1).toBe("1 Main St");
    expect(details?.address_from?.name).toBe("Ada Lovelace");
    expect(details?.address_to?.street1).toBe("200 Pine St");
    expect(details?.address_to?.name).toBe("Seller Shop");
    expect(details?.extra?.is_return).toBe(true);
  });

  it("uses local delivery address as the return sender when checkout shipping is missing", () => {
    const details = buildOrderDetailsFromOrder(
      makeOrder({
        shippingAddress: null,
        localDeliveryDetails: {
          deliveryAddress: { street: "9 Oak Ave", city: "Spokane", state: "WA", zip: "99203" },
        },
      }),
      null,
      {
        isReturn: true,
        sellerFromAddress: {
          name: "Seller Shop",
          street1: "200 Pine St",
          city: "Spokane",
          state: "WA",
          zip: "99202",
          country: "US",
        },
      }
    );
    expect(details?.address_from?.street1).toBe("9 Oak Ave");
    expect(details?.address_to?.street1).toBe("200 Pine St");
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

describe("label PDF URLs from Shippo transactions", () => {
  it("collects unique http(s) label URLs and drops junk", () => {
    expect(
      collectLabelUrlsFromTransactions([
        { label_url: "https://deliver.goshippo.com/a.pdf" },
        { label_url: "https://deliver.goshippo.com/a.pdf" },
        { label_url: "https://deliver.goshippo.com/b.pdf" },
        { label_url: "javascript:alert(1)" },
        { label_url: "  " },
        {},
      ])
    ).toEqual(["https://deliver.goshippo.com/a.pdf", "https://deliver.goshippo.com/b.pdf"]);
  });

  it("keeps insertion order for uniqueHttpUrls", () => {
    expect(uniqueHttpUrls(["https://z.example/1", null, "https://z.example/2", "https://z.example/1"])).toEqual([
      "https://z.example/1",
      "https://z.example/2",
    ]);
  });
});
