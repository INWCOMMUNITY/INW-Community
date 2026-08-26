import { describe, it, expect } from "vitest";
import {
  buildEtsyCreateFields,
  buildEtsyUpdateFields,
  etsyListingToSummary,
  etsyOriginTrioFields,
  sanitizeEtsyTitle,
} from "./mapping";
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

describe("etsyOriginTrioFields", () => {
  it("returns the full trio or nothing", () => {
    expect(etsyOriginTrioFields(makeItem({ etsyWhoMade: null }))).toBeNull();
    expect(etsyOriginTrioFields(makeItem({ etsyIsSupply: null }))).toEqual({
      who_made: "i_did",
      when_made: "2020_2026",
      is_supply: false,
    });
  });
});

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
    expect(fields.is_supply).toBe(false);
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

  it("softens all-caps titles before create", () => {
    const fields = buildEtsyCreateFields(
      makeItem({
        title: "Library of Coins EARLY SILVER DOLLARS Coin Album Volume 49 VERY RARE 1794/1803",
      }),
      conn,
      { readinessStateId: 42 }
    );
    expect(fields.title).toBe(
      "Library of Coins Early Silver Dollars Coin Album Volume 49 Very Rare 1794/1803"
    );
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
  it("sends who_made, when_made, and is_supply together even when supply is unset", () => {
    const fields = buildEtsyUpdateFields(makeItem({ etsyIsSupply: null }));
    expect(fields.who_made).toBe("i_did");
    expect(fields.when_made).toBe("2020_2026");
    expect(fields.is_supply).toBe(false);
  });

  it("omits the whole origin trio when who/when is missing so price can still PATCH", () => {
    const fields = buildEtsyUpdateFields(makeItem({ etsyWhoMade: null, etsyWhenMade: null }));
    expect(fields.who_made).toBeUndefined();
    expect(fields.when_made).toBeUndefined();
    expect(fields.is_supply).toBeUndefined();
    expect(fields.price).toBeDefined();
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

  it("prefers url_fullxfull over url_570xN", () => {
    const summary = etsyListingToSummary({
      listing_id: 1,
      title: "Mug",
      images: [
        {
          rank: 1,
          url_fullxfull: "https://i.etsystatic.com/full.jpg",
          url_570xN: "https://i.etsystatic.com/570.jpg",
        },
      ],
    });
    expect(summary.photos).toEqual(["https://i.etsystatic.com/full.jpg"]);
  });
});

describe("sanitizeEtsyTitle", () => {
  it("converts long ALL-CAPS words so Etsy all_caps validation passes", () => {
    expect(
      sanitizeEtsyTitle(
        "Library of Coins EARLY SILVER DOLLARS Coin Album Volume 49 VERY RARE 1794/1803"
      )
    ).toBe("Library of Coins Early Silver Dollars Coin Album Volume 49 Very Rare 1794/1803");
  });

  it("keeps short coin acronyms", () => {
    expect(sanitizeEtsyTitle("2002-S NGC PF 69 Ultra Cameo Roosevelt Dime")).toBe(
      "2002-S NGC PF 69 Ultra Cameo Roosevelt Dime"
    );
  });

  it("title-cases extra short all-caps words after the third", () => {
    expect(sanitizeEtsyTitle("NGC PF MS AU extra")).toBe("NGC PF MS Au extra");
  });

  it("truncates to 140 characters", () => {
    expect(sanitizeEtsyTitle("A".repeat(200)).length).toBe(140);
  });
});
