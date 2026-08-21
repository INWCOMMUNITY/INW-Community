import { describe, expect, it } from "vitest";
import {
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
