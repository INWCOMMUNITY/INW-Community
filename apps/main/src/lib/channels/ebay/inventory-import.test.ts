import { describe, expect, it } from "vitest";
import { inventoryRowToTradingListing, mergeInventoryRowsWithTrading, indexOfferFulfillmentPolicies, resolveEbayListingFulfillmentPolicyId } from "./inventory-import";

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

describe("resolveEbayListingFulfillmentPolicyId", () => {
  const offerIndex = indexOfferFulfillmentPolicies([
    { sku: "inw123", listingId: "123", fulfillmentPolicyId: "pol-from-offer" },
  ]);

  it("prefers the listing's Trading shipping profile over the shop default / offer", () => {
    expect(
      resolveEbayListingFulfillmentPolicyId({
        tradingProfileId: "pol-listing",
        listingId: "123",
        sku: "inw123",
        offerIndex,
      })
    ).toBe("pol-listing");
  });

  it("falls back to the Inventory offer policy for the same listing id", () => {
    expect(
      resolveEbayListingFulfillmentPolicyId({
        tradingProfileId: null,
        listingId: "123",
        sku: "other",
        offerIndex,
      })
    ).toBe("pol-from-offer");
  });

  it("does not use a generic shop policy when the listing has none", () => {
    expect(
      resolveEbayListingFulfillmentPolicyId({
        tradingProfileId: null,
        listingId: "999",
        sku: "missing",
        offerIndex,
      })
    ).toBeNull();
  });
});
