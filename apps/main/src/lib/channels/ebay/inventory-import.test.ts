import { describe, expect, it } from "vitest";
import { inventoryRowToTradingListing, mergeInventoryRowsWithTrading } from "./inventory-import";

describe("inventoryRowToTradingListing", () => {
  it("maps inventory rows into importable listing rows", () => {
    expect(
      inventoryRowToTradingListing({
        sku: "sku-b",
        product: { title: "Inventory SKU", imageUrls: ["https://example.com/a.jpg"] },
        availability: { shipToLocationAvailability: { quantity: 2 } },
      })
    ).toMatchObject({
      listingId: "sku-b",
      title: "Inventory SKU",
      quantity: 2,
      sku: "sku-b",
    });
  });
});

describe("mergeInventoryRowsWithTrading", () => {
  it("adds inventory-only SKUs without duplicating Trading rows", () => {
    const merged = mergeInventoryRowsWithTrading(
      [{ listingId: "123", title: "A", priceCents: 100, quantity: 1, photos: [], sku: "sku-a" }],
      [{ sku: "sku-a" }, { sku: "sku-b", product: { title: "B" } }]
    );
    expect(merged).toHaveLength(2);
    expect(merged.map((row) => row.sku)).toEqual(["sku-a", "sku-b"]);
  });
});
