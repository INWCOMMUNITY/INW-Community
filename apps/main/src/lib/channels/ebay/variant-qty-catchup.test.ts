import { describe, expect, it } from "vitest";
import {
  chooseEbayLiveListingQuantity,
  ebayCatchUpAdoptedLiveQty,
  ebayContentPushShouldWriteVariantQuantities,
  ebaySingleSkuQtyMatrix,
} from "./variant-qty-catchup";
import { variantsStructureQtyFingerprint } from "../variant-sync";

const variants = {
  axes: [{ name: "Size", values: ["S"] }],
  skus: [{ options: { Size: "S" }, quantity: 4, sku: "SKU-S" }],
};

describe("chooseEbayLiveListingQuantity", () => {
  it("copies Seller Hub inventory onto the live offer when they disagree", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 4,
        inventoryQty: 9,
        offerQty: 4,
        inwQty: 4,
      })
    ).toEqual({ quantity: 9, source: "inventory", writeOffers: true });
  });

  it("keeps a seller edit that landed on the offer while inventory still echoes INW", () => {
    // The bug: we used to take inventory (still INW's 3) and write it over the seller's 1.
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 3,
        inventoryQty: 3,
        offerQty: 1,
        inwQty: 3,
      })
    ).toEqual({ quantity: 1, source: "offer", writeOffers: true });
  });

  it("prefers the live offer when inventory and offer both moved off INW", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 3,
        inventoryQty: 7,
        offerQty: 5,
        inwQty: 3,
      })
    ).toEqual({ quantity: 5, source: "offer", writeOffers: true });
  });

  it("does not copy lagged GetItem onto the offer when inventory already matches View Item", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 4,
        inventoryQty: 9,
        offerQty: 9,
        inwQty: 4,
      })
    ).toEqual({ quantity: 9, source: "offer", writeOffers: false });
  });

  it("writes a simple-listing Seller Hub qty onto the live offer", () => {
    // Price revises update the offer natively; quantity revises often only hit Trading.
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 5,
        inventoryQty: 1,
        offerQty: 1,
        inwQty: 1,
      })
    ).toEqual({ quantity: 5, source: "trading", writeOffers: true });
  });

  it("does not write Trading over inventory+offer while our push is still echoing", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 9,
        inventoryQty: 4,
        offerQty: 4,
        inwQty: 4,
        inwPushedRecently: true,
      })
    ).toEqual({ quantity: 4, source: "offer", writeOffers: false });
  });

  it("returns Seller Hub qty without rewriting offers when inventory, offer, and Trading agree", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 9,
        inventoryQty: 9,
        offerQty: 9,
        inwQty: 4,
      })
    ).toEqual({ quantity: 9, source: "offer", writeOffers: false });
  });

  it("does not rewrite offers when Seller Hub already matches the live listing", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 4,
        inventoryQty: 4,
        offerQty: 4,
        inwQty: 4,
      })
    ).toEqual({ quantity: 4, source: "offer", writeOffers: false });
  });

  it("ignores degraded all-1s Trading qty", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 1,
        inventoryQty: 4,
        offerQty: 4,
        inwQty: 4,
        tradingLooksDegraded: true,
      })
    ).toEqual({ quantity: 4, source: "offer", writeOffers: false });
  });

  it("writes the Seller Hub revise onto the live offer when only Trading moved", () => {
    // Revise form shows 1, View Item still shows 2.
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 1,
        inventoryQty: 2,
        offerQty: 2,
        inwQty: 2,
      })
    ).toEqual({ quantity: 1, source: "trading", writeOffers: true });
  });

  it("does not let lagged Trading undo our own push", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 2,
        inventoryQty: 5,
        offerQty: 5,
        inwQty: 5,
        inwPushedRecently: true,
      })
    ).toEqual({ quantity: 5, source: "offer", writeOffers: false });
  });

  it("still ignores a degraded all-1s Trading read", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 1,
        inventoryQty: 4,
        offerQty: 4,
        inwQty: 4,
        tradingLooksDegraded: true,
      })
    ).toEqual({ quantity: 4, source: "offer", writeOffers: false });
  });

  it("prefers Seller Hub inventory when live offer qty is missing", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 4,
        inventoryQty: 9,
        offerQty: null,
        inwQty: 4,
      })
    ).toEqual({ quantity: 9, source: "inventory", writeOffers: true });
  });

  it("never writes Trading onto the offer when inventory and offer are missing", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 9,
        inventoryQty: null,
        offerQty: null,
        inwQty: 4,
      })
    ).toEqual({ quantity: 9, source: "trading", writeOffers: false });
  });

  it("writes Seller Hub inventory onto the offer when INW still matches View Item", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 1,
        inventoryQty: 5,
        offerQty: 1,
        inwQty: 1,
      })
    ).toEqual({ quantity: 5, source: "inventory", writeOffers: true });
  });

  it("does not write the offer when every surface already matches INW", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 1,
        inventoryQty: 1,
        offerQty: 1,
        inwQty: 1,
      })
    ).toEqual({ quantity: 1, source: "offer", writeOffers: false });
  });

  it("does not write Trading that matches INW after a recent push", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 5,
        inventoryQty: 1,
        offerQty: 1,
        inwQty: 5,
        inwPushedRecently: true,
      })
    ).toEqual({ quantity: 1, source: "offer", writeOffers: false });
  });

  it("does not copy lagged warehouse over an offer that already matches a recent INW push", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 4,
        inventoryQty: 4,
        offerQty: 9,
        inwQty: 9,
        inwPushedRecently: true,
      })
    ).toEqual({ quantity: 9, source: "offer", writeOffers: false });
  });

  it("does not write the offer when the only readable qty is still INW's number", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 4,
        inventoryQty: 4,
        offerQty: null,
        inwQty: 4,
      })
    ).toEqual({ quantity: 4, source: "inventory", writeOffers: false });
  });
});

describe("ebayContentPushShouldWriteVariantQuantities", () => {
  it("writes qty on create and when INW qty drifted from baseline", () => {
    expect(
      ebayContentPushShouldWriteVariantQuantities({
        operation: "create",
        baselineQty: 4,
        baselineVariantsHash: "x",
        listingQty: 4,
        variants,
      })
    ).toBe(true);
    expect(
      ebayContentPushShouldWriteVariantQuantities({
        operation: "update",
        baselineQty: 40,
        baselineVariantsHash: variantsStructureQtyFingerprint(variants),
        listingQty: 40,
        variants,
      })
    ).toBe(false);
    expect(
      ebayContentPushShouldWriteVariantQuantities({
        operation: "update",
        baselineQty: 40,
        baselineVariantsHash: variantsStructureQtyFingerprint(variants),
        listingQty: 12,
        variants,
      })
    ).toBe(true);
  });
});

describe("ebaySingleSkuQtyMatrix", () => {
  it("builds a one-SKU matrix for simple-listing catch-up", () => {
    expect(ebaySingleSkuQtyMatrix("inw404516850572", 5)).toEqual({
      axes: [],
      skus: [{ sku: "inw404516850572", options: {}, quantity: 5 }],
    });
  });
});

describe("ebayCatchUpAdoptedLiveQty", () => {
  it("is false when catch-up only read SKUs that still match INW", () => {
    expect(
      ebayCatchUpAdoptedLiveQty({
        quantities: [{ sku: "a", options: {}, quantity: 1 }],
        wroteOffers: false,
        inwNeedsUpdate: false,
      })
    ).toBe(false);
  });

  it("is true when catch-up wrote the offer or needs an INW qty update", () => {
    expect(
      ebayCatchUpAdoptedLiveQty({
        quantities: [{ sku: "a", options: {}, quantity: 5 }],
        wroteOffers: true,
        inwNeedsUpdate: false,
      })
    ).toBe(true);
  });
});
