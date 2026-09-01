import { describe, expect, it } from "vitest";
import {
  buildEbayInventoryItem,
  ebayListingToSummary,
  findEbayRemoteListing,
  indexEbayRemoteListings,
  resolveCategoryId,
  resolveEbayLegacyListingId,
} from "./mapping";
import type { SyncStoreItem } from "../types";

describe("resolveCategoryId", () => {
  const base = { ebayCategoryId: 12345 } as SyncStoreItem;

  it("prefers per-item ebayCategoryId over INW category map override", () => {
    expect(resolveCategoryId(base, "99999")).toBe("12345");
  });

  it("uses category map when item has no ebayCategoryId", () => {
    expect(resolveCategoryId({ ...base, ebayCategoryId: null }, "99999")).toBe("99999");
  });
});

describe("resolveEbayLegacyListingId", () => {
  it("accepts numeric Item IDs", () => {
    expect(resolveEbayLegacyListingId("393315434144")).toBe("393315434144");
  });

  it("extracts legacy id from INW SKU", () => {
    expect(resolveEbayLegacyListingId("inw394295737513")).toBe("394295737513");
  });

  it("rejects 8-digit seller SKUs that are not eBay Item IDs", () => {
    expect(resolveEbayLegacyListingId("51515151")).toBeNull();
  });

  it("rejects non-legacy ids", () => {
    expect(resolveEbayLegacyListingId("offer-abc")).toBeNull();
  });
});

describe("ebayListingToSummary", () => {
  it("uses numeric Item ID for externalListingId even when SKU is inw-prefixed", () => {
    const summary = ebayListingToSummary({
      listingId: "393315434144",
      sku: "inw393315434144",
      title: "Test item",
      price: { value: "19.99" },
      availableQuantity: 2,
    });
    expect(summary.externalListingId).toBe("393315434144");
    expect(summary.sku).toBe("inw393315434144");
  });

  it("copies packageWeightAndSize onto the import summary", () => {
    const summary = ebayListingToSummary({
      listingId: "1",
      title: "Test item",
      remoteShippingProfileId: "pol-1",
      packageWeightAndSize: {
        weight: { value: 24, unit: "OUNCE" },
        dimensions: { length: 10, width: 8, height: 6, unit: "INCH" },
      },
    });
    expect(summary.remoteShippingProfileId).toBe("pol-1");
    expect(summary.packageWeightOz).toBe(24);
    expect(summary.packageLengthIn).toBe(10);
    expect(summary.packageWidthIn).toBe(8);
    expect(summary.packageHeightIn).toBe(6);
  });

  it("does not invent a shipping profile when the listing has none", () => {
    const summary = ebayListingToSummary({
      listingId: "1",
      title: "Test item",
      price: { value: "1.00" },
    });
    expect(summary.remoteShippingProfileId).toBeNull();
  });
});

describe("indexEbayRemoteListings", () => {
  const listings = [
    ebayListingToSummary({
      listingId: "393315434144",
      sku: "inw393315434144",
      title: "A",
      price: { value: "1.00" },
      availableQuantity: 1,
    }),
  ];

  it("finds listings by link SKU", () => {
    const map = indexEbayRemoteListings(listings);
    expect(map.get("inw393315434144")).toBe(listings[0]);
    expect(findEbayRemoteListing(listings, "inw393315434144")).toBe(listings[0]);
  });

  it("finds listings by legacy Item ID", () => {
    expect(findEbayRemoteListing(listings, "393315434144")).toBe(listings[0]);
  });
});

function makeInventoryItem(overrides: Partial<SyncStoreItem> = {}): SyncStoreItem {
  return {
    id: "item-1",
    sku: null,
    title: "Test item",
    description: "A thing",
    photos: [],
    priceCents: 1000,
    quantity: 1,
    variants: null,
    status: "active",
    condition: "new",
    category: null,
    subcategory: null,
    secondaryCategory: null,
    shippingCostCents: 0,
    etsyWhoMade: null,
    etsyWhenMade: null,
    etsyIsSupply: null,
    etsyTaxonomyId: null,
    ebayCategoryId: null,
    ebayConditionEnum: null,
    aspects: null,
    ...overrides,
  };
}

describe("buildEbayInventoryItem", () => {
  it("includes packageWeightAndSize when the listing option is complete", () => {
    const body = buildEbayInventoryItem(
      makeInventoryItem({
        package: {
          source: "inw",
          remoteProfileId: null,
          weightOz: 24,
          lengthIn: 10,
          widthIn: 8,
          heightIn: 6,
        },
      })
    );
    expect(body.packageWeightAndSize).toEqual({
      dimensions: { height: 6, length: 10, width: 8, unit: "INCH" },
      weight: { value: 24, unit: "OUNCE" },
    });
  });

  it("copies Brand Name onto Brand for inventory PUT", () => {
    const body = buildEbayInventoryItem(
      makeInventoryItem({
        aspects: [
          { name: "Type", value: "Clock" },
          { name: "Brand Name", value: "Does Not Apply" },
        ],
      })
    );
    expect((body.product as { aspects?: Record<string, string[]> }).aspects).toMatchObject({
      Type: ["Clock"],
      "Brand Name": ["Does Not Apply"],
      Brand: ["Does Not Apply"],
    });
  });

  it("omits packageWeightAndSize when the option is incomplete", () => {
    const body = buildEbayInventoryItem(
      makeInventoryItem({
        package: {
          source: "ebay",
          remoteProfileId: "pol-1",
          weightOz: 24,
          lengthIn: 10,
          widthIn: 8,
          heightIn: null,
        },
      })
    );
    expect(body.packageWeightAndSize).toBeUndefined();
  });
});
