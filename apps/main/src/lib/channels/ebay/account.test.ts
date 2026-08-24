import { describe, expect, it } from "vitest";
import { ebayPolicyDomesticShippingCostCents } from "./account";

describe("ebayPolicyDomesticShippingCostCents", () => {
  it("reads the domestic flat-rate service cost", () => {
    expect(
      ebayPolicyDomesticShippingCostCents({
        shippingOptions: [
          {
            optionType: "INTERNATIONAL",
            costType: "FLAT_RATE",
            shippingServices: [{ shippingCost: { value: "19.99" } }],
          },
          {
            optionType: "DOMESTIC",
            costType: "FLAT_RATE",
            shippingServices: [{ shippingCost: { value: "5.99" } }],
          },
        ],
      })
    ).toBe(599);
  });

  it("treats freeShipping as 0 and skips calculated policies", () => {
    expect(
      ebayPolicyDomesticShippingCostCents({
        shippingOptions: [
          {
            optionType: "DOMESTIC",
            costType: "FLAT_RATE",
            shippingServices: [{ freeShipping: true, shippingCost: { value: "5.99" } }],
          },
        ],
      })
    ).toBe(0);
    expect(
      ebayPolicyDomesticShippingCostCents({
        shippingOptions: [{ optionType: "DOMESTIC", costType: "CALCULATED", shippingServices: [] }],
      })
    ).toBeNull();
  });
});
