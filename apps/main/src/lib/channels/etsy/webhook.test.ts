import { describe, expect, it } from "vitest";
import {
  isEtsyListingWebhookTopic,
  isEtsySalesWebhookTopic,
  parseEtsyWebhookEnvelope,
} from "./webhook";

describe("parseEtsyWebhookEnvelope", () => {
  it("reads listing_id from a listings/updated payload", () => {
    expect(
      parseEtsyWebhookEnvelope({
        topic: "listings/updated",
        shop_id: 99,
        listing_id: 123456,
      })
    ).toEqual({ topic: "listings/updated", shopId: "99", listingId: "123456" });
  });

  it("reads nested data.listing_id", () => {
    expect(
      parseEtsyWebhookEnvelope({
        topic: "listings/changed",
        data: { shop_id: "88", listing_id: "777" },
      })
    ).toEqual({ topic: "listings/changed", shopId: "88", listingId: "777" });
  });
});

describe("etsy webhook topic routing", () => {
  it("treats listing updates as listing events, not sales", () => {
    expect(isEtsyListingWebhookTopic("listings/updated")).toBe(true);
    expect(isEtsySalesWebhookTopic("listings/updated")).toBe(false);
    expect(isEtsySalesWebhookTopic("shop/receipts")).toBe(true);
  });
});
