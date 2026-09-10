import { describe, expect, it } from "vitest";
import {
  ebayOfferIsPublished,
  pickEbayOffer,
  readEbayOfferListingId,
  shouldDeleteUnpublishedZeroQuantityOffer,
  shouldPublishEbayInventoryGroup,
  shouldPublishEbayOffer,
  shouldRepublishEbayOffer,
  shouldSkipEbayInventoryContentPutAtZeroQty,
  shouldSkipEbayUnpublishedZeroQuantitySync,
  shouldWriteEbayOffer,
  shouldBlockEbayUpdateForMissingAspects,
  shouldFetchTradingItemOnUpsert,
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

  it("does not EndItem+republish when revising an already-linked listing", () => {
    expect(
      shouldRepublishEbayOffer({
        operation: "update",
        canPublish: true,
        itemIsActive: true,
        quantity: 1,
        offerId: "o1",
        offerStatus: "UNPUBLISHED",
      })
    ).toBe(false);
    expect(
      shouldPublishEbayInventoryGroup({
        operation: "update",
        canPublish: true,
        itemIsActive: true,
        inStock: true,
        hadOfferAtStart: false,
      })
    ).toBe(false);
    expect(
      shouldPublishEbayInventoryGroup({
        operation: "create",
        canPublish: true,
        itemIsActive: true,
        inStock: true,
        hadOfferAtStart: false,
      })
    ).toBe(true);
    expect(
      shouldPublishEbayInventoryGroup({
        operation: "create",
        canPublish: true,
        itemIsActive: true,
        inStock: true,
        hadOfferAtStart: false,
        listingAlreadyLinked: true,
      })
    ).toBe(false);
    expect(
      shouldRepublishEbayOffer({
        operation: "create",
        canPublish: true,
        itemIsActive: true,
        quantity: 1,
        offerId: "o1",
        offerStatus: "UNPUBLISHED",
      })
    ).toBe(true);
    expect(
      shouldPublishEbayInventoryGroup({
        operation: "create",
        canPublish: true,
        itemIsActive: true,
        inStock: true,
        hadOfferAtStart: false,
        listingAlreadyLinked: false,
      })
    ).toBe(true);
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
    expect(shouldSkipEbayInventoryContentPutAtZeroQty(0)).toBe(true);
    expect(shouldSkipEbayInventoryContentPutAtZeroQty(1)).toBe(false);
    expect(
      shouldSkipEbayUnpublishedZeroQuantitySync({
        quantity: 0,
        offerStatus: "UNPUBLISHED",
      })
    ).toBe(true);
    expect(
      shouldSkipEbayUnpublishedZeroQuantitySync({
        quantity: 0,
        offerStatus: "PUBLISHED",
      })
    ).toBe(false);
    expect(
      shouldSkipEbayUnpublishedZeroQuantitySync({
        quantity: 1,
        offerStatus: "UNPUBLISHED",
      })
    ).toBe(false);
  });

  it("does not block live listing updates for missing Type/Brand", () => {
    expect(shouldBlockEbayUpdateForMissingAspects(true)).toBe(false);
    expect(shouldBlockEbayUpdateForMissingAspects(false)).toBe(true);
  });

  it("skips Trading GetItem on live simple updates", () => {
    expect(
      shouldFetchTradingItemOnUpsert({ listingAlreadyLinked: true, usesInventoryItemGroup: false })
    ).toBe(false);
    expect(
      shouldFetchTradingItemOnUpsert({ listingAlreadyLinked: true, usesInventoryItemGroup: true })
    ).toBe(true);
    expect(
      shouldFetchTradingItemOnUpsert({ listingAlreadyLinked: false, usesInventoryItemGroup: false })
    ).toBe(true);
  });
});
