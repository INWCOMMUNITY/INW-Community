import { describe, it, expect } from "vitest";
import { buildEtsyCreateFields, buildEtsyUpdateFields, etsyListingToSummary } from "./mapping";
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
    const fields = buildEtsyCreateFields(makeItem(), conn, { readinessStateId: 42 });
    expect(fields.who_made).toBe("i_did");
    expect(fields.when_made).toBe("2020_2026");
    expect(fields.taxonomy_id).toBe(891);
    expect(fields.readiness_state_id).toBe(42);
    expect(fields.item_weight).toBe("16.0");
    expect(fields.item_length).toBe("12.0");
    expect(fields.item_width).toBe("12.0");
    expect(fields.item_height).toBe("12.0");
    expect(fields.item_weight_unit).toBe("oz");
    expect(fields.item_dimensions_unit).toBe("in");
  });

  it("throws when readiness_state_id is missing", () => {
    expect(() => buildEtsyCreateFields(makeItem(), conn)).toThrow(/processing profile/i);
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

  it("sends real package measurements when the listing has a complete shipping option", () => {
    const fields = buildEtsyCreateFields(
      makeItem({
        package: {
          source: "inw",
          remoteProfileId: null,
          weightOz: 24,
          lengthIn: 10,
          widthIn: 8,
          heightIn: 6,
        },
      }),
      conn,
      { readinessStateId: 42 }
    );
    expect(fields.item_weight).toBe("24.0");
    expect(fields.item_length).toBe("10.0");
    expect(fields.item_width).toBe("8.0");
    expect(fields.item_height).toBe("6.0");
  });

  it("uses the imported Etsy profile id from the shipping option", () => {
    const fields = buildEtsyCreateFields(
      makeItem({
        package: {
          source: "etsy",
          remoteProfileId: "555",
          weightOz: 8,
          lengthIn: 10,
          widthIn: 8,
          heightIn: 6,
        },
      }),
      conn,
      { readinessStateId: 42 }
    );
    expect(fields.shipping_profile_id).toBe(555);
  });
});

describe("buildEtsyUpdateFields", () => {
  it("maps legacy when_made without inventing defaults", () => {
    const fields = buildEtsyUpdateFields(makeItem({ etsyWhenMade: "before_1960" }));
    expect(fields.when_made).toBe("1950s");
    expect(fields.who_made).toBe("i_did");
  });

  it("includes shipping_profile_id only when provided", () => {
    expect(buildEtsyUpdateFields(makeItem()).shipping_profile_id).toBeUndefined();
    expect(buildEtsyUpdateFields(makeItem(), { shippingProfileId: "99" }).shipping_profile_id).toBe(
      99
    );
  });

  it("sends real package measurements on update when the option is complete", () => {
    const fields = buildEtsyUpdateFields(
      makeItem({
        package: {
          source: "etsy",
          remoteProfileId: "77",
          weightOz: 8,
          lengthIn: 10,
          widthIn: 8,
          heightIn: 6,
        },
      })
    );
    expect(fields.shipping_profile_id).toBe(77);
    expect(fields.item_weight).toBe("8.0");
    expect(fields.item_length).toBe("10.0");
  });
});

describe("etsyListingToSummary", () => {
  it("copies shipping profile and package fields from the Etsy listing", () => {
    const summary = etsyListingToSummary({
      listing_id: 1,
      title: "Mug",
      shipping_profile_id: 77,
      item_weight: 8,
      item_weight_unit: "oz",
      item_length: 10,
      item_width: 8,
      item_height: 6,
      item_dimensions_unit: "in",
    });
    expect(summary.remoteShippingProfileId).toBe("77");
    expect(summary.packageWeightOz).toBe(8);
    expect(summary.packageLengthIn).toBe(10);
    expect(summary.packageWidthIn).toBe(8);
    expect(summary.packageHeightIn).toBe(6);
  });
});
