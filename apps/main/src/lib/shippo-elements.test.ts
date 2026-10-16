import { describe, expect, it } from "vitest";
import {
  buildCombinedOrderDetails,
  buildOrderDetailsFromOrder,
  collectLabelUrlsFromTransactions,
  ordersCanCombineShipping,
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

  it("prefills Shippo parcels from listing shipping-option dimensions", () => {
    const details = buildOrderDetailsFromOrder(makeOrder());
    expect(details?.parcels).toEqual([
      {
        length: "10",
        width: "6",
        height: "4",
        distance_unit: "in",
        weight: "16",
        mass_unit: "oz",
      },
    ]);
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

  it("combines same-buyer orders into one Shippo package", () => {
    const first = makeOrder({ id: "order-1", orderNumber: "A1", buyer: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" } });
    const second = makeOrder({
      id: "order-2",
      orderNumber: "B2",
      buyer: { firstName: "Ada", lastName: "Lovelace", email: "Ada@example.com" },
      items: [
        {
          quantity: 1,
          priceCentsAtPurchase: 2500,
          fulfillmentType: "ship",
          storeItem: {
            title: "Bowl",
            shippingOption: { weightOz: 12, lengthIn: 8, widthIn: 8, heightIn: 5 },
          },
        },
      ],
    });
    expect(ordersCanCombineShipping([first, second])).toBe(true);
    const details = buildCombinedOrderDetails([first, second]);
    expect(Array.isArray(details)).toBe(false);
    const third = makeOrder({
      id: "order-3",
      orderNumber: "C3",
      buyer: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
      items: [
        {
          quantity: 1,
          priceCentsAtPurchase: 500,
          storeItem: {
            title: "Plate",
            shippingOption: { weightOz: 4, lengthIn: 6, widthIn: 6, heightIn: 2 },
          },
        },
      ],
    });
    const three = buildCombinedOrderDetails([first, second, third]);
    expect(Array.isArray(three)).toBe(false);
    expect(three?.line_items).toHaveLength(1);
    expect(three?.line_items[0]?.quantity).toBe(1);
    expect(three?.line_items[0]?.title).toBe("Combined shipment");
    expect(three?.order_number).toMatch(/^CMB[0-9A-F]{8,}$/);
    expect(details?.line_items).toHaveLength(1);
    expect(details?.line_items[0]?.quantity).toBe(1);
    expect(details?.line_items[0]?.unit_weight).toBe("28");
    expect(details?.line_items[0]?.title).toBe("Combined shipment");
    expect(details?.parcels).toBeUndefined();
    expect(details?.order_number).toMatch(/^CMB[0-9A-F]{8,}$/);
    expect(details?.order_number).not.toBe(three?.order_number);
    expect(details?.address_to.street1).toBe("1 Main St");
  });

  it("does not combine orders to different addresses", () => {
    const first = makeOrder({ buyer: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" } });
    const second = makeOrder({
      id: "order-2",
      buyer: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
      shippingAddress: { street: "9 Oak Ave", city: "Spokane", state: "WA", zip: "99203" },
    });
    expect(ordersCanCombineShipping([first, second])).toBe(false);
    expect(buildCombinedOrderDetails([first, second])).toBeNull();
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
