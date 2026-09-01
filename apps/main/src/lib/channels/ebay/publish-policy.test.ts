import { describe, expect, it } from "vitest";
import {
  ebayOfferIsPublished,
  pickEbayOffer,
  readEbayOfferListingId,
  shouldDeleteUnpublishedZeroQuantityOffer,
  shouldPublishEbayOffer,
  shouldWriteEbayOffer,
} from "./publish-policy";

describe("publish-policy", () => {
  it("prefers a published offer when unpublished leftovers exist for the same SKU", () => {
    expect(
      pickEbayOffer([
        { offerId: "old", status: "UNPUBLISHED", listing: { listingId: "111" } },
        { offerId: "live", status: "PUBLISHED", listing: { listingId: "222" } },
      ])?.offerId
    ).toBe("live");
  });

  it("does not publish again when the offer is already live", () => {
    expect(
      shouldPublishEbayOffer({
        canPublish: true,
        itemIsActive: true,
        quantity: 1,
        offerId: "o1",
        offerStatus: "PUBLISHED",
      })
    ).toBe(false);
  });

  it("publishes only unpublished offers", () => {
    expect(
      shouldPublishEbayOffer({
        canPublish: true,
        itemIsActive: true,
        quantity: 1,
        offerId: "o1",
        offerStatus: "UNPUBLISHED",
      })
    ).toBe(true);
    expect(ebayOfferIsPublished("published")).toBe(true);
    expect(readEbayOfferListingId({ listing: { listingId: 394295737513 } })).toBe("394295737513");
  });

  it("does not write unpublished offers at quantity 0", () => {
    expect(
      shouldWriteEbayOffer({
        quantity: 0,
        offerId: "o1",
        offerStatus: "UNPUBLISHED",
      })
    ).toBe(false);
    expect(
      shouldWriteEbayOffer({
        quantity: 0,
        offerId: null,
        offerStatus: null,
      })
    ).toBe(false);
    expect(
      shouldWriteEbayOffer({
        quantity: 0,
        offerId: "o1",
        offerStatus: "PUBLISHED",
      })
    ).toBe(true);
    expect(
      shouldDeleteUnpublishedZeroQuantityOffer({
        quantity: 0,
        offerId: "o1",
        offerStatus: "UNPUBLISHED",
      })
    ).toBe(true);
  });
});
