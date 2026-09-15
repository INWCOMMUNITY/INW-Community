import { describe, expect, it } from "vitest";
import {
  inventoryRowToTradingListing,
  mergeLiveEbayImportListings,
  indexOfferFulfillmentPolicies,
  liveEbayOfferShouldAppearInImport,
  resolveEbayListingFulfillmentPolicyId,
} from "./inventory-import";

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

describe("liveEbayOfferShouldAppearInImport", () => {
  it("requires a published offer with a numeric Item ID", () => {
    expect(liveEbayOfferShouldAppearInImport({ status: "PUBLISHED", listingId: "123" })).toBe(true);
    expect(liveEbayOfferShouldAppearInImport({ status: "UNPUBLISHED", listingId: "123" })).toBe(
      false
    );
    expect(liveEbayOfferShouldAppearInImport({ status: "PUBLISHED", listingId: "nwcABC123" })).toBe(
      false
    );
    expect(liveEbayOfferShouldAppearInImport({ status: "PUBLISHED", listingId: null })).toBe(false);
  });
});

describe("mergeLiveEbayImportListings", () => {
  it("does not add leftover inventory SKUs that are not live listings", () => {
    const merged = mergeLiveEbayImportListings(
      [{ listingId: "123", title: "A", priceCents: 100, quantity: 1, photos: [], sku: "sku-a" }],
      [{ sku: "sku-b", status: "UNPUBLISHED", listingId: null }],
      [
        { sku: "sku-a" },
        {
          sku: "sku-b",
          product: { title: "Ended test listing" },
          availability: { shipToLocationAvailability: { quantity: 4 } },
        },
      ]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.listingId).toBe("123");
  });

  it("adds a published offer only when ActiveList missed the live Item ID", () => {
    const merged = mergeLiveEbayImportListings(
      [{ listingId: "123", title: "A", priceCents: 100, quantity: 1, photos: [], sku: "sku-a" }],
      [
        { sku: "sku-b", status: "PUBLISHED", listingId: "456", priceCents: 250 },
        { sku: "sku-c", status: "PUBLISHED", listingId: "456", priceCents: 250 },
      ],
      [{ sku: "sku-b", product: { title: "Inventory-only live" } }]
    );
    expect(merged.map((row) => row.listingId)).toEqual(["123", "456"]);
    expect(merged[1]).toMatchObject({
      listingId: "456",
      title: "Inventory-only live",
      priceCents: 250,
      sku: "sku-b",
    });
  });

  it("does not explode a variation listing into one import row per SKU", () => {
    const merged = mergeLiveEbayImportListings(
      [
        {
          listingId: "999",
          title: "Clock",
          priceCents: 250,
          quantity: 12,
          photos: [],
          sku: "parent",
        },
      ],
      [
        { sku: "v1", status: "PUBLISHED", listingId: "999" },
        { sku: "v2", status: "PUBLISHED", listingId: "999" },
        { sku: "v3", status: "PUBLISHED", listingId: "999" },
      ],
      [{ sku: "v1" }, { sku: "v2" }, { sku: "v3" }]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.listingId).toBe("999");
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
