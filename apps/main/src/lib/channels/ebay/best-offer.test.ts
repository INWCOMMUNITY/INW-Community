import { describe, expect, it } from "vitest";
import {
  applyBestOfferTermsToOfferBody,
  bestOfferStatesMatch,
  buildEbayBestOfferTerms,
  inwBestOfferEnabled,
  inwBestOfferState,
  readOfferBestOfferTerms,
} from "./best-offer";
import type { SyncStoreItem } from "../types";

const usedItem = {
  id: "item-1",
  sku: null,
  title: "Used coin",
  description: null,
  photos: [],
  priceCents: 10000,
  quantity: 1,
  variants: null,
  status: "active",
  condition: "used",
  category: null,
  subcategory: null,
  secondaryCategory: null,
  shippingCostCents: null,
  etsyWhoMade: null,
  etsyWhenMade: null,
  etsyIsSupply: null,
  etsyTaxonomyId: null,
  ebayCategoryId: null,
  ebayConditionEnum: null,
  aspects: [],
  acceptOffers: true,
  minOfferCents: 8000,
} satisfies SyncStoreItem;

describe("best-offer helpers", () => {
  it("disables best offer for new condition listings", () => {
    expect(inwBestOfferEnabled({ ...usedItem, condition: "new", acceptOffers: true })).toBe(false);
    expect(buildEbayBestOfferTerms({ ...usedItem, condition: "new" })).toEqual({
      bestOfferEnabled: false,
    });
  });

  it("builds autoDeclinePrice when minOfferCents set", () => {
    expect(buildEbayBestOfferTerms(usedItem)).toEqual({
      bestOfferEnabled: true,
      autoDeclinePrice: { value: "79.99", currency: "USD" },
    });
  });

  it("reads live offer bestOfferTerms from listingPolicies", () => {
    expect(
      readOfferBestOfferTerms({
        listingPolicies: {
          bestOfferTerms: {
            bestOfferEnabled: true,
            autoDeclinePrice: { value: "79.99", currency: "USD" },
          },
        },
      })
    ).toEqual({ acceptOffers: true, minOfferCents: 8000 });
  });

  it("applyBestOfferTermsToOfferBody writes listingPolicies.bestOfferTerms", () => {
    const offer: Record<string, unknown> = {
      listingPolicies: { paymentPolicyId: "pay-1", returnPolicyId: "ret-1" },
      bestOfferTerms: { bestOfferEnabled: false },
    };
    applyBestOfferTermsToOfferBody(offer, usedItem);
    expect(offer.bestOfferTerms).toBeUndefined();
    expect(offer.listingPolicies).toEqual({
      paymentPolicyId: "pay-1",
      returnPolicyId: "ret-1",
      bestOfferTerms: {
        bestOfferEnabled: true,
        autoDeclinePrice: { value: "79.99", currency: "USD" },
      },
    });
  });

  it("matches normalized INW and eBay best offer states", () => {
    expect(
      bestOfferStatesMatch(
        { acceptOffers: true, minOfferCents: 8000 },
        inwBestOfferState(usedItem)
      )
    ).toBe(true);
  });
});
