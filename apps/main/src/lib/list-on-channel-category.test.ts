import { describe, expect, it } from "vitest";
import {
  buildListOnCategoryQueue,
  buildListOnCategoryQueueFromDesired,
  buildListOnCategoryQueueFromFailedSpecifics,
  isEbaySpecificsAttentionItem,
  isMissingEbayItemSpecificsError,
  itemNeedsListOnCategoryStep,
  listOnStepFromEbayAttentionItem,
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

  it("always queues eBay even when a previous try already saved Type and Brand", () => {
    const steps = buildListOnCategoryQueue(
      [
        item({
          ebayCategoryId: 261605,
          aspects: [
            { name: "Type", value: "Clock" },
            { name: "Brand", value: "Unbranded" },
          ],
        }),
      ],
      ["ebay"]
    );
    expect(steps.map((s) => s.item.id)).toEqual(["item-1"]);
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

  it("does not queue already-linked eBay when that store stays checked", () => {
    const steps = buildListOnCategoryQueueFromDesired(
      [
        item({
          id: "a",
          ebayCategoryId: 11450,
          aspects: [
            { name: "Type", value: "Clock" },
            { name: "Brand", value: "Unbranded" },
          ],
          channelLinks: [{ provider: "ebay" }],
        }),
      ],
      { a: ["ebay"] }
    );
    expect(steps).toEqual([]);
  });

  it("does not queue already-linked eBay even when Type or Brand is still missing", () => {
    const steps = buildListOnCategoryQueueFromDesired(
      [
        item({
          id: "a",
          ebayCategoryId: 11450,
          channelLinks: [{ provider: "ebay" }],
        }),
      ],
      { a: ["ebay"] }
    );
    expect(steps).toEqual([]);
  });

  it("only queues items that are adding eBay, not ones already listed there", () => {
    const steps = buildListOnCategoryQueueFromDesired(
      [
        item({
          id: "already",
          ebayCategoryId: 261605,
          channelLinks: [{ provider: "ebay" }],
        }),
        item({ id: "new", ebayCategoryId: null, channelLinks: [{ provider: "etsy" }] }),
      ],
      { already: ["ebay"], new: ["etsy", "ebay"] }
    );
    expect(steps.map((s) => `${s.item.id}:${s.provider}`)).toEqual(["new:ebay"]);
  });
});

describe("buildListOnCategoryQueueFromFailedSpecifics", () => {
  it("queues eBay for failed items even when they are already linked", () => {
    const steps = buildListOnCategoryQueueFromFailedSpecifics(
      [
        item({
          id: "a",
          ebayCategoryId: 11450,
          channelLinks: [{ provider: "ebay" }],
        }),
        item({ id: "b" }),
      ],
      ["a"]
    );
    expect(steps.map((s) => `${s.item.id}:${s.provider}`)).toEqual(["a:ebay"]);
  });
});

describe("isEbaySpecificsAttentionItem", () => {
  it("matches fillable Type/Brand fields and missing-specifics errors", () => {
    expect(
      isEbaySpecificsAttentionItem({
        provider: "ebay",
        storeItemId: "a",
        action: "fill",
        fields: [{ key: "aspect:Type" }],
      })
    ).toBe(true);
    expect(
      isEbaySpecificsAttentionItem({
        provider: "ebay",
        storeItemId: "a",
        action: "retry_only",
        fields: [],
        syncError: "Missing required eBay item specifics: Type, Brand.",
      })
    ).toBe(true);
    expect(
      isEbaySpecificsAttentionItem({
        provider: "etsy",
        storeItemId: "a",
        fields: [{ key: "etsyWhoMade" }],
      })
    ).toBe(false);
  });
});

describe("listOnStepFromEbayAttentionItem", () => {
  it("builds a centered eBay picker step from Needs Attention fields", () => {
    const step = listOnStepFromEbayAttentionItem({
      storeItemId: "a",
      title: "Bear Clock",
      photo: "/clock.jpg",
      ebayCategoryId: 11450,
      fields: [{ key: "aspect:Type" }, { key: "aspect:Brand" }],
    });
    expect(step.provider).toBe("ebay");
    expect(step.item.id).toBe("a");
    expect(step.item.ebayCategoryId).toBe(11450);
    expect(step.requiredAspectNames).toEqual(["Type", "Brand"]);
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
    expect(
      isMissingEbayItemSpecificsError(
        "Listing details didn't update on eBay: [#25002] The item specific Type is missing. — eBay needs Type on this listing."
      )
    ).toBe(true);
  });
});
