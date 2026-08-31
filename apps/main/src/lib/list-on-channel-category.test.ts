import { describe, expect, it } from "vitest";
import {
  buildListOnCategoryQueue,
  buildListOnCategoryQueueFromDesired,
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

  it("needs an eBay step only when category is missing", () => {
    expect(itemNeedsListOnCategoryStep(item(), "ebay")).toBe(true);
    expect(itemNeedsListOnCategoryStep(item({ ebayCategoryId: 11450 }), "ebay")).toBe(false);
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
    expect(steps.map((s) => s.item.id)).toEqual(["a", "c"]);
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
