import { describe, expect, it } from "vitest";
import {
  etsyProfileDomesticShippingCostCents,
  isEtsyCalculatedShippingProfile,
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
