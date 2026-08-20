import { describe, expect, it } from "vitest";
import { connectionReadyToPublish, publishBlockReason } from "./connection-publish";

describe("connectionReadyToPublish", () => {
  it("allows Etsy without a shipping profile so List on can create a draft", () => {
    expect(
      connectionReadyToPublish({
        provider: "etsy",
        status: "active",
        etsyShippingProfileId: null,
        config: null,
      })
    ).toBe(true);
    expect(
      publishBlockReason({
        provider: "etsy",
        status: "active",
        etsyShippingProfileId: null,
        config: null,
      })
    ).toBeNull();
  });

  it("blocks eBay until policies and a merchant location are set", () => {
    expect(
      connectionReadyToPublish({
        provider: "ebay",
        status: "active",
        etsyShippingProfileId: null,
        config: {},
      })
    ).toBe(false);
    expect(
      publishBlockReason({
        provider: "ebay",
        status: "active",
        etsyShippingProfileId: null,
        config: {},
      })
    ).toMatch(/policies|location/i);
  });

  it("blocks Shopify until shop and location are set", () => {
    expect(
      connectionReadyToPublish({
        provider: "shopify",
        status: "active",
        etsyShippingProfileId: null,
        config: { shop: "demo.myshopify.com" },
      })
    ).toBe(false);
  });

  it("treats Wix as ready once the store is connected", () => {
    expect(
      connectionReadyToPublish({
        provider: "wix",
        status: "active",
        etsyShippingProfileId: null,
        config: null,
      })
    ).toBe(true);
  });
});
