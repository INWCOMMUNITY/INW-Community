import { describe, expect, it } from "vitest";
import { listingShippingCostUpdate } from "./listing-shipping-price";

describe("listingShippingCostUpdate", () => {
  it("keeps a saved price when the incoming value is blank", () => {
    expect(listingShippingCostUpdate(799, null)).toBe(799);
  });

  it("applies an explicit free-shipping price", () => {
    expect(listingShippingCostUpdate(799, 0)).toBe(0);
  });

  it("applies a new price", () => {
    expect(listingShippingCostUpdate(799, 450)).toBe(450);
  });

  it("allows a blank price when nothing was saved", () => {
    expect(listingShippingCostUpdate(null, null)).toBeNull();
    expect(listingShippingCostUpdate(0, null)).toBeNull();
  });
});
