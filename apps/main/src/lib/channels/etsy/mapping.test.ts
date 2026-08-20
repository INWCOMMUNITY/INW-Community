import { describe, it, expect } from "vitest";
import { buildEtsyCreateFields, buildEtsyUpdateFields } from "./mapping";
import type { ChannelConnectionContext, SyncStoreItem } from "../types";

function makeItem(overrides: Partial<SyncStoreItem> = {}): SyncStoreItem {
  return {
    id: "item-1",
    sku: null,
    title: "Handmade mug",
    description: "A mug",
    photos: ["https://example.com/mug.jpg"],
    priceCents: 1200,
    quantity: 2,
    variants: null,
    status: "active",
    condition: "new",
    category: "Home & Living",
    subcategory: null,
    secondaryCategory: null,
    shippingCostCents: 500,
    etsyWhoMade: "i_did",
    etsyWhenMade: "2020_2025",
    etsyIsSupply: false,
    etsyTaxonomyId: 891,
    ebayCategoryId: null,
    ebayConditionEnum: null,
    aspects: null,
    ...overrides,
  };
}

const conn: ChannelConnectionContext = {
  id: "conn-1",
  memberId: "member-1",
  provider: "etsy",
  externalShopId: "123",
  accessToken: "token",
  etsyShippingProfileId: "99",
  config: null,
};

describe("buildEtsyCreateFields", () => {
  it("maps legacy when_made onto the current Etsy enum", () => {
    const fields = buildEtsyCreateFields(makeItem(), conn);
    expect(fields.who_made).toBe("i_did");
    expect(fields.when_made).toBe("2020_2026");
    expect(fields.taxonomy_id).toBe(891);
  });

  it("throws when who_made is missing", () => {
    expect(() => buildEtsyCreateFields(makeItem({ etsyWhoMade: null }), conn)).toThrow(/who made/i);
  });

  it("throws when when_made is missing", () => {
    expect(() => buildEtsyCreateFields(makeItem({ etsyWhenMade: null }), conn)).toThrow(/when it was made/i);
  });

  it("throws when taxonomy is missing", () => {
    expect(() =>
      buildEtsyCreateFields(makeItem({ etsyTaxonomyId: null }), conn, { taxonomyId: undefined })
    ).toThrow(/category/i);
  });
});

describe("buildEtsyUpdateFields", () => {
  it("maps legacy when_made without inventing defaults", () => {
    const fields = buildEtsyUpdateFields(makeItem({ etsyWhenMade: "before_1960" }));
    expect(fields.when_made).toBe("1950s");
    expect(fields.who_made).toBe("i_did");
  });
});
