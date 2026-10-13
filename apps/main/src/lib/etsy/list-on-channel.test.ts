import { describe, expect, it } from "vitest";
import { emptyEtsyHowItsMadeFormValue } from "@/components/etsy/EtsyHowItsMadeFields";
import {
  buildEtsyListAttributesBody,
  validateEtsyListOnChannelForm,
} from "@/lib/etsy/list-on-channel";

describe("validateEtsyListOnChannelForm", () => {
  it("requires who / what / when for stocked items", () => {
    expect(
      validateEtsyListOnChannelForm({
        howItsMade: emptyEtsyHowItsMadeFormValue(),
        inventoryTracking: "quantity",
      })
    ).toEqual({ ok: false, error: "Choose who made it." });

    expect(
      validateEtsyListOnChannelForm({
        howItsMade: {
          ...emptyEtsyHowItsMadeFormValue(),
          etsyWhoMade: "i_did",
          etsyIsSupply: false,
        },
        inventoryTracking: "quantity",
      })
    ).toEqual({ ok: false, error: "Choose when it was made." });
  });

  it("skips when-made for made_to_order inventory", () => {
    expect(
      validateEtsyListOnChannelForm({
        howItsMade: {
          ...emptyEtsyHowItsMadeFormValue(),
          etsyWhoMade: "i_did",
          etsyIsSupply: false,
          etsyWhenMade: "",
        },
        inventoryTracking: "made_to_order",
      })
    ).toEqual({ ok: true });
  });
});

describe("buildEtsyListAttributesBody", () => {
  it("maps How it’s made into the PATCH body and forces made_to_order when", () => {
    expect(
      buildEtsyListAttributesBody({
        howItsMade: {
          etsyWhoMade: "i_did",
          etsyWhenMade: "2020_2026",
          etsyIsSupply: false,
          etsyTaxonomyId: "101",
        },
        inventoryTracking: "made_to_order",
      })
    ).toEqual({
      etsyWhoMade: "i_did",
      etsyWhenMade: "made_to_order",
      etsyIsSupply: false,
      etsyTaxonomyId: 101,
    });
  });

  it("omits taxonomy when blank", () => {
    expect(
      buildEtsyListAttributesBody({
        howItsMade: {
          etsyWhoMade: "someone_else",
          etsyWhenMade: "2020_2026",
          etsyIsSupply: true,
          etsyTaxonomyId: "",
        },
        inventoryTracking: "quantity",
      })
    ).toEqual({
      etsyWhoMade: "someone_else",
      etsyWhenMade: "2020_2026",
      etsyIsSupply: true,
    });
  });
});
