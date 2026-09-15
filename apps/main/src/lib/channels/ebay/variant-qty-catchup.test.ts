import { describe, expect, it } from "vitest";
import {
  chooseEbayLiveListingQuantity,
  ebayContentPushShouldWriteVariantQuantities,
  ebaySingleSkuQtyMatrix,
  liveEbayInventorySkuCandidatesForCatchUpRow,
} from "./variant-qty-catchup";
import { variantsStructureQtyFingerprint } from "../variant-sync";

const variants = {
  axes: [{ name: "Size", values: ["S"] }],
  skus: [{ options: { Size: "S" }, quantity: 4, sku: "SKU-S" }],
};

describe("chooseEbayLiveListingQuantity", () => {
  it("copies Hub warehouse onto View Item when the offer still equals INW", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 4,
        inventoryQty: 9,
        offerQty: 4,
        inwQty: 4,
      })
    ).toEqual({ quantity: 9, source: "inventory", writeOffers: true });
  });

  it("does not copy an INW echo over an offer that already moved off INW", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 3,
        inventoryQty: 3,
        offerQty: 1,
        inwQty: 3,
      })
    ).toEqual({ quantity: 1, source: "offer", writeOffers: false });
  });

  it("copies Hub warehouse onto View Item when the offer moved off INW but warehouse disagrees", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 3,
        inventoryQty: 7,
        offerQty: 5,
        inwQty: 3,
      })
    ).toEqual({ quantity: 7, source: "inventory", writeOffers: true });
  });

  it("does not copy lagged Trading over View Item that already shows Hub warehouse", () => {
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

  it("does not copy Hub warehouse over View Item that already matches a recent INW push", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 4,
        inventoryQty: 9,
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

  it("seeds the offer from Hub warehouse when offer qty is unread", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 4,
        inventoryQty: 9,
        offerQty: null,
        inwQty: 4,
      })
    ).toEqual({ quantity: 9, source: "inventory", writeOffers: true });
  });

  it("writes Hub Trading onto a live offer id when warehouse qty is unread", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 5,
        inventoryQty: null,
        offerQty: null,
        inwQty: 1,
        canWriteOffers: true,
      })
    ).toEqual({ quantity: 5, source: "trading", writeOffers: true });
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

  it("copies Hub warehouse onto the offer when Trading still matches INW", () => {
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

  it("does not write the offer when qty is unread but Trading already matches INW and warehouse", () => {
    expect(
      chooseEbayLiveListingQuantity({
        tradingQty: 4,
        inventoryQty: 4,
        offerQty: null,
        inwQty: 4,
      })
    ).toEqual({ quantity: 4, source: "trading", writeOffers: false });
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

describe("liveEbayInventorySkuCandidatesForCatchUpRow", () => {
  it("prefers the live GetItem Custom Label over a hub-minted INW SKU", () => {
    expect(
      liveEbayInventorySkuCandidatesForCatchUpRow(
        { sku: "nwcAbCdEfGh12", options: { Size: "S" } },
        {
          axes: [],
          skus: [{ sku: "cmsz85hpj0001ahwfa2pmvtun", options: { Size: "S" }, quantity: 9 }],
        }
      )
    ).toEqual(["cmsz85hpj0001ahwfa2pmvtun", "nwcAbCdEfGh12"]);
  });

  it("keeps the INW SKU when GetItem has no Custom Label", () => {
    expect(
      liveEbayInventorySkuCandidatesForCatchUpRow(
        { sku: "HAT42", options: {} },
        { axes: [], skus: [{ sku: null, options: {}, quantity: 4 }] }
      )
    ).toEqual(["HAT42"]);
  });
});
