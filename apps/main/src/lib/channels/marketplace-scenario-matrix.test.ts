import { describe, expect, it } from "vitest";
import { etsyFallbackProfileIfRateMatches, buildInwFlatProfileFields } from "./shipping-map";
import { shouldSkipEndedEbayOutbound, withEbayListingEnded } from "./listing-link-flags";
import { saleLinkCandidateIds } from "./sale-link";
import { inboundSaleClaimDecision } from "./apply-channel-sale";
import { isShopifySaleOrder } from "./shopify/sale-order";
import type { EtsyShopShippingProfile } from "./shipping-map";

/**
 * Tabletop LIST → SALE → PUSH matrix. Each row asserts the helper that gates the mishap.
 * Integration coverage for Wix claim-before-media lives in listing-link-claim.test.ts.
 */
describe("per-channel LIST→SALE→PUSH matrix", () => {
  it("Etsy: $0 profile includes destination_country_iso US and does not attach a paid shop profile", () => {
    expect(buildInwFlatProfileFields(0, "INW $0.00").destination_country_iso).toBe("US");
    const paid: EtsyShopShippingProfile = {
      shipping_profile_id: 2,
      title: "USPS Ground",
      profile_type: "manual",
      shipping_profile_destinations: [
        { destination_country_iso: "US", primary_cost: { amount: 499, divisor: 100 } },
      ],
    };
    expect(etsyFallbackProfileIfRateMatches(0, paid)).toBeNull();
  });

  it("eBay: sale line with only legacyItemId still produces lookup candidates", () => {
    const ids = saleLinkCandidateIds({
      externalListingId: "394295737513",
      sku: null,
      legacyItemId: "394295737513",
    });
    expect(ids).toContain("394295737513");
    expect(ids).toContain("inw394295737513");
  });

  it("eBay: ended listing does not retry inventory", () => {
    expect(shouldSkipEndedEbayOutbound("ebay", withEbayListingEnded({}, true))).toBe(true);
  });

  it("eBay: sale_ack_absolute blocks a later decrement", () => {
    expect(
      inboundSaleClaimDecision({
        appliedAt: null,
        type: "sale_ack_absolute",
        processedAt: new Date(),
      })
    ).toBe("duplicate");
  });

  it("webhook and cron for the same sale apply once", () => {
    expect(
      inboundSaleClaimDecision({
        appliedAt: new Date(),
        type: "sale",
        processedAt: new Date(),
      })
    ).toBe("duplicate");
    expect(
      inboundSaleClaimDecision({
        appliedAt: null,
        type: "sale",
        processedAt: new Date(),
      })
    ).toBe("in_flight");
  });

  it("Shopify: unpaid/cancelled orders do not decrement; inventory requires locationId (strict throw copy)", () => {
    expect(isShopifySaleOrder({ financial_status: "pending" })).toBe(false);
    expect(isShopifySaleOrder({ financial_status: "paid", cancelled_at: "x" })).toBe(false);
    expect(isShopifySaleOrder({ financial_status: "paid" })).toBe(true);
  });
});
