import { describe, expect, it } from "vitest";
import {
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
