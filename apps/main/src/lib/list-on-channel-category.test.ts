import { describe, expect, it } from "vitest";
import {
  buildListOnCategoryQueue,
  buildListOnCategoryQueueFromDesired,
  isMissingEbayItemSpecificsError,
  itemNeedsListOnCategoryStep,
  mergeListOnCategoryAssignment,
  type ListOnCategoryItem,
} from "./list-on-channel-category";

function item(overrides: Partial<ListOnCategoryItem> = {}): ListOnCategoryItem {
  return {
    id: "item-1",
    title: "Bear Clock",
    photos: [],
    etsyTaxonomyId: null,
    ebayCategoryId: null,
    etsyWhoMade: "i_did",
    etsyWhenMade: "made_to_order",
    channelLinks: [],
    ...overrides,
  };
}

describe("itemNeedsListOnCategoryStep", () => {
  it("needs an Etsy step when taxonomy is missing", () => {
    expect(itemNeedsListOnCategoryStep(item(), "etsy")).toBe(true);
  });

  it("needs an Etsy step when who/when are missing even if taxonomy is set", () => {
    expect(
      itemNeedsListOnCategoryStep(
        item({ etsyTaxonomyId: 33, etsyWhoMade: null, etsyWhenMade: null }),
        "etsy"
      )
    ).toBe(true);
  });

  it("does not need an Etsy step when category and details are set", () => {
    expect(itemNeedsListOnCategoryStep(item({ etsyTaxonomyId: 33 }), "etsy")).toBe(false);
  });

  it("needs an eBay step when category or Type/Brand specifics are missing", () => {
    expect(itemNeedsListOnCategoryStep(item(), "ebay")).toBe(true);
    expect(itemNeedsListOnCategoryStep(item({ ebayCategoryId: 11450 }), "ebay")).toBe(true);
    expect(
      itemNeedsListOnCategoryStep(
        item({
          ebayCategoryId: 11450,
          aspects: [
            { name: "Type", value: "Clock" },
            { name: "Brand", value: "Unbranded" },
          ],
        }),
        "ebay"
      )
    ).toBe(false);
  });
});

describe("buildListOnCategoryQueue", () => {
  it("queues missing eBay categories across selected items", () => {
    const items = [
      item({ id: "a", title: "One", ebayCategoryId: null }),
      item({ id: "b", title: "Two", ebayCategoryId: 11450 }),
      item({ id: "c", title: "Three", ebayCategoryId: null }),
    ];
    const steps = buildListOnCategoryQueue(items, ["ebay"]);
    expect(steps.map((s) => s.item.id)).toEqual(["a", "b", "c"]);
    expect(steps.every((s) => s.provider === "ebay")).toBe(true);
  });

  it("skips items already linked to that store", () => {
    const steps = buildListOnCategoryQueue(
      [item({ id: "a", channelLinks: [{ provider: "etsy" }] })],
      ["etsy"]
    );
    expect(steps).toEqual([]);
  });

  it("queues Etsy then eBay for the same item when both are missing", () => {
    const steps = buildListOnCategoryQueue([item()], ["etsy", "ebay"]);
    expect(steps.map((s) => s.provider)).toEqual(["etsy", "ebay"]);
  });
});

describe("buildListOnCategoryQueueFromDesired", () => {
  it("only queues stores this item is adding", () => {
    const steps = buildListOnCategoryQueueFromDesired(
      [
        item({ id: "a", ebayCategoryId: null, etsyTaxonomyId: null }),
        item({ id: "b", ebayCategoryId: null, etsyTaxonomyId: 9 }),
      ],
      { a: ["ebay"], b: ["etsy"] }
    );
    expect(steps.map((s) => `${s.item.id}:${s.provider}`)).toEqual(["a:ebay"]);
  });
});

describe("mergeListOnCategoryAssignment", () => {
  it("keeps both provider fields for the same item", () => {
    const merged = mergeListOnCategoryAssignment(
      { storeItemId: "a", etsyTaxonomyId: 33 },
      { storeItemId: "a", ebayCategoryId: 11450 }
    );
    expect(merged).toEqual({ storeItemId: "a", etsyTaxonomyId: 33, ebayCategoryId: 11450 });
  });

  it("includes eBay item specifics from the later patch", () => {
    const merged = mergeListOnCategoryAssignment(
      { storeItemId: "a", ebayCategoryId: 11450 },
      { storeItemId: "a", aspects: [{ name: "Brand", value: "Unbranded" }] }
    );
    expect(merged.aspects).toEqual([{ name: "Brand", value: "Unbranded" }]);
  });
});

describe("isMissingEbayItemSpecificsError", () => {
  it("matches eBay publish errors that the category popup can collect", () => {
    expect(
      isMissingEbayItemSpecificsError(
        "eBay: Missing required eBay item specifics: Type. Fill them in under eBay Listing Requirements."
      )
    ).toBe(true);
    expect(isMissingEbayItemSpecificsError("Could not list on Etsy.")).toBe(false);
  });
});
