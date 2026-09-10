import { describe, expect, it } from "vitest";
import {
  SHOPIFY_INVENTORY_INDEX_KEY,
  indexedProductIdForInventoryItem,
  orderLinksByIndexedProduct,
  readShopifyInventoryIndex,
  withShopifyInventoryIndexEntry,
} from "./inventory-index";

describe("readShopifyInventoryIndex", () => {
  it("returns an empty map for missing/invalid config", () => {
    expect(readShopifyInventoryIndex(null)).toEqual({});
    expect(readShopifyInventoryIndex({})).toEqual({});
    expect(readShopifyInventoryIndex({ [SHOPIFY_INVENTORY_INDEX_KEY]: "nope" })).toEqual({});
  });

  it("coerces numeric product ids to strings and drops empties", () => {
    const config = {
      [SHOPIFY_INVENTORY_INDEX_KEY]: { "111": 222, "333": "444", "555": "" },
    };
    expect(readShopifyInventoryIndex(config)).toEqual({ "111": "222", "333": "444" });
  });
});

describe("indexedProductIdForInventoryItem", () => {
  it("resolves a known inventory item to its product id", () => {
    const config = { [SHOPIFY_INVENTORY_INDEX_KEY]: { "111": "prod-1" } };
    expect(indexedProductIdForInventoryItem(config, 111)).toBe("prod-1");
    expect(indexedProductIdForInventoryItem(config, "111")).toBe("prod-1");
  });

  it("returns null for an unknown item", () => {
    expect(indexedProductIdForInventoryItem({}, 999)).toBeNull();
  });
});

describe("orderLinksByIndexedProduct", () => {
  const links = [
    { externalListingId: "a" },
    { externalListingId: "b" },
    { externalListingId: "c" },
  ];

  it("moves the indexed product to the front so it is tried first", () => {
    expect(orderLinksByIndexedProduct(links, "c").map((l) => l.externalListingId)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("is a no-op when there is no index hit or it is already first", () => {
    expect(orderLinksByIndexedProduct(links, null)).toBe(links);
    expect(orderLinksByIndexedProduct(links, "a").map((l) => l.externalListingId)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(orderLinksByIndexedProduct(links, "missing").map((l) => l.externalListingId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("withShopifyInventoryIndexEntry", () => {
  it("adds a new mapping", () => {
    expect(withShopifyInventoryIndexEntry({}, 111, "prod-1")).toEqual({ "111": "prod-1" });
  });

  it("returns the same reference when unchanged (avoids needless config writes)", () => {
    const index = { "111": "prod-1" };
    expect(withShopifyInventoryIndexEntry(index, 111, "prod-1")).toBe(index);
  });

  it("overwrites a stale mapping", () => {
    expect(withShopifyInventoryIndexEntry({ "111": "old" }, 111, "new")).toEqual({ "111": "new" });
  });
});
