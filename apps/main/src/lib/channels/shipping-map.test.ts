import { describe, expect, it } from "vitest";
import {
  buildInwFlatProfileFields,
  etsyFallbackProfileIfRateMatches,
  etsyProfileDomesticShippingCostCents,
  isEtsyCalculatedShippingProfile,
  isEtsyMissingShopsWriteScope,
  pickPreferredEtsyShippingProfile,
  shippingProfileIdForEtsyUpdate,
  type EtsyShopShippingProfile,
} from "./shipping-map";

const calculated: EtsyShopShippingProfile = {
  shipping_profile_id: 1,
  title: "Calculated",
  profile_type: "calculated",
};
const manual: EtsyShopShippingProfile = {
  shipping_profile_id: 2,
  title: "USPS Ground",
  profile_type: "manual",
};

describe("pickPreferredEtsyShippingProfile", () => {
  it("prefers a stored manual profile", () => {
    const picked = pickPreferredEtsyShippingProfile([calculated, manual], "2");
    expect(picked?.shipping_profile_id).toBe(2);
  });

  it("skips a stored calculated profile when a manual one exists", () => {
    const picked = pickPreferredEtsyShippingProfile([calculated, manual], "1");
    expect(picked?.shipping_profile_id).toBe(2);
  });

  it("treats a missing profile_type as calculated", () => {
    expect(isEtsyCalculatedShippingProfile({ profile_type: null })).toBe(true);
    expect(isEtsyCalculatedShippingProfile({ profile_type: "manual" })).toBe(false);
  });

  it("falls back to the calculated profile when it is the only option", () => {
    const picked = pickPreferredEtsyShippingProfile([calculated], "1");
    expect(picked?.shipping_profile_id).toBe(1);
    expect(isEtsyCalculatedShippingProfile(picked)).toBe(true);
  });
});

describe("shippingProfileIdForEtsyUpdate", () => {
  it("omits calculated profiles so PATCH does not require package size", () => {
    expect(
      shippingProfileIdForEtsyUpdate({ shippingProfileId: "1", isCalculated: true })
    ).toBeNull();
  });

  it("keeps manual profiles", () => {
    expect(
      shippingProfileIdForEtsyUpdate({ shippingProfileId: "2", isCalculated: false })
    ).toBe("2");
  });
});

describe("etsyProfileDomesticShippingCostCents", () => {
  it("reads the US destination primary cost", () => {
    expect(
      etsyProfileDomesticShippingCostCents({
        shipping_profile_id: 3,
        profile_type: "manual",
        shipping_profile_destinations: [
          {
            destination_country_iso: "CA",
            primary_cost: { amount: 1200, divisor: 100 },
          },
          {
            destination_country_iso: "US",
            primary_cost: { amount: 499, divisor: 100 },
          },
        ],
      })
    ).toBe(499);
  });

  it("returns null for calculated profiles", () => {
    expect(
      etsyProfileDomesticShippingCostCents({
        shipping_profile_id: 1,
        profile_type: "calculated",
        shipping_profile_destinations: [
          { destination_country_iso: "US", primary_cost: { amount: 0, divisor: 100 } },
        ],
      })
    ).toBeNull();
  });
});

describe("buildInwFlatProfileFields", () => {
  it("includes destination_country_iso US for a $0.00 profile", () => {
    const fields = buildInwFlatProfileFields(0, "INW $0.00");
    expect(fields).toEqual({
      title: "INW $0.00",
      origin_country_iso: "US",
      destination_country_iso: "US",
      primary_cost: "0.00",
      secondary_cost: "0.00",
      min_processing_time: 1,
      max_processing_time: 3,
    });
    expect(fields).not.toHaveProperty("destination_region");
  });

  it("formats a non-zero rate as dollars", () => {
    expect(buildInwFlatProfileFields(499, "INW $4.99").primary_cost).toBe("4.99");
    expect(buildInwFlatProfileFields(499, "INW $4.99").destination_country_iso).toBe("US");
  });
});

describe("etsyFallbackProfileIfRateMatches", () => {
  const paid: EtsyShopShippingProfile = {
    shipping_profile_id: 2,
    title: "USPS Ground",
    profile_type: "manual",
    shipping_profile_destinations: [
      { destination_country_iso: "US", primary_cost: { amount: 499, divisor: 100 } },
    ],
  };
  const free: EtsyShopShippingProfile = {
    shipping_profile_id: 9,
    title: "INW $0.00",
    profile_type: "manual",
    shipping_profile_destinations: [
      { destination_country_iso: "US", primary_cost: { amount: 0, divisor: 100 } },
    ],
  };

  it("rejects a paid shop profile when the intended rate is $0", () => {
    expect(etsyFallbackProfileIfRateMatches(0, paid)).toBeNull();
  });

  it("accepts a shop profile whose US primary cost matches", () => {
    expect(etsyFallbackProfileIfRateMatches(0, free)?.shipping_profile_id).toBe(9);
    expect(etsyFallbackProfileIfRateMatches(499, paid)?.shipping_profile_id).toBe(2);
  });

  it("rejects calculated profiles", () => {
    expect(etsyFallbackProfileIfRateMatches(0, calculated)).toBeNull();
  });
});

describe("isEtsyMissingShopsWriteScope", () => {
  it("detects the shops_w 403 from creating shipping profiles", () => {
    expect(
      isEtsyMissingShopsWriteScope(
        new Error("Access token lacks scope for this request (requires scope: shops_w).")
      )
    ).toBe(true);
    expect(isEtsyMissingShopsWriteScope(new Error("Etsy API error (400)"))).toBe(false);
  });
});
