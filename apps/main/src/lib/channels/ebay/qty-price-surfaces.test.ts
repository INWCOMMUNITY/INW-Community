import { describe, expect, it } from "vitest";
import {
  buildEbayBulkUpdatePriceQuantityRequest,
  buildEbayQtyPriceSurfaces,
  ebayBulkUpdateResponseFailed,
  ebayCatchupPriceCents,
  ebayCatchupQuantity,
  ebayCatchupShouldWrite,
  ebayCatchupShouldWriteVariantRow,
  ebayCatchupVariantAddress,
  ebayHubPriceAheadOfOffer,
  ebayHubQtyAheadOfViewItem,
  selectEbayHubCatchupOptionRows,
  selectEbayHubCatchupVariantRows,
  summarizeEbayQtyPriceSurfaces,
} from "./qty-price-surfaces";

describe("eBay qty/price surfaces", () => {
  it("detects Hub listed remaining ahead of View Item / offer", () => {
    const surfaces = buildEbayQtyPriceSurfaces({
      hubQuantity: 7,
      viewItemQuantity: 3,
      offerQuantity: 3,
      warehouseQuantity: 3,
      inwQuantity: 3,
      hubPriceCents: 1200,
      offerPriceCents: 1200,
      inwPriceCents: 1200,
    });
    expect(ebayHubQtyAheadOfViewItem(surfaces)).toBe(true);
    expect(ebayCatchupShouldWrite(surfaces)).toBe(true);
    expect(ebayCatchupQuantity(surfaces)).toBe(7);
    expect(ebayCatchupPriceCents(surfaces)).toBeNull();
    expect(summarizeEbayQtyPriceSurfaces(surfaces).verdict).toBe("hub_ahead_of_view_item");
  });

  it("detects Hub price ahead of the live offer without treating INW as the write source", () => {
    const surfaces = buildEbayQtyPriceSurfaces({
      hubQuantity: 2,
      viewItemQuantity: 2,
      offerQuantity: 2,
      warehouseQuantity: 2,
      inwQuantity: 2,
      hubPriceCents: 4400,
      offerPriceCents: 1999,
      inwPriceCents: 1999,
    });
    expect(ebayHubPriceAheadOfOffer(surfaces)).toBe(true);
    expect(ebayCatchupShouldWrite(surfaces)).toBe(true);
    expect(ebayCatchupPriceCents(surfaces)).toBe(4400);
  });

  it("does not catch up when Hub, offer, and INW already match", () => {
    const surfaces = buildEbayQtyPriceSurfaces({
      hubQuantity: 4,
      viewItemQuantity: 4,
      offerQuantity: 4,
      warehouseQuantity: 4,
      inwQuantity: 4,
      hubPriceCents: 2500,
      offerPriceCents: 2500,
      inwPriceCents: 2500,
    });
    expect(ebayCatchupShouldWrite(surfaces)).toBe(false);
    expect(summarizeEbayQtyPriceSurfaces(surfaces).verdict).toBe("aligned");
  });

  it("uses Hub listed remaining and Hub price in the bulk_update payload", () => {
    const surfaces = buildEbayQtyPriceSurfaces({
      hubQuantity: 7,
      viewItemQuantity: 3,
      offerQuantity: 3,
      warehouseQuantity: 3,
      inwQuantity: 3,
      hubPriceCents: 4400,
      offerPriceCents: 1999,
      inwPriceCents: 1999,
    });
    expect(ebayCatchupQuantity(surfaces)).toBe(7);
    expect(ebayCatchupPriceCents(surfaces)).toBe(4400);
    const body = buildEbayBulkUpdatePriceQuantityRequest({
      sku: "cmt123",
      offerId: "offer-9",
      quantity: ebayCatchupQuantity(surfaces)!,
      priceCents: ebayCatchupPriceCents(surfaces),
      currency: "USD",
      priceValue: "44.00",
    });
    expect(body.requests[0]?.sku).toBe("cmt123");
    expect(body.requests[0]?.offers).toEqual([
      {
        offerId: "offer-9",
        availableQuantity: 7,
        price: { currency: "USD", value: "44.00" },
      },
    ]);
  });

  it("catch-up variation rows keep per-SKU qty/price and never invent a parent SKU from INW", () => {
    expect(selectEbayHubCatchupVariantRows([])).toEqual([]);
    expect(
      selectEbayHubCatchupVariantRows([
        { sku: "cmts", quantity: 2, priceCents: 1200 },
        { sku: "cmtm", quantity: 5, priceCents: 1500 },
        { sku: "  ", quantity: 9, priceCents: 1800 },
        { sku: "cmt7vumcl000dxjujvgwe8dob-Purple", quantity: 3, priceCents: 1800 },
      ])
    ).toEqual([
      { sku: "cmts", quantity: 2, priceCents: 1200 },
      { sku: "cmtm", quantity: 5, priceCents: 1500 },
    ]);
    expect(
      ebayCatchupShouldWriteVariantRow({
        hubQuantity: 2,
        offerQuantity: 5,
        hubPriceCents: 1200,
        offerPriceCents: 1200,
      })
    ).toBe(true);
    expect(
      ebayCatchupShouldWriteVariantRow({
        hubQuantity: 2,
        offerQuantity: 2,
        hubPriceCents: 1500,
        offerPriceCents: 1200,
      })
    ).toBe(true);
    expect(
      ebayCatchupShouldWriteVariantRow({
        hubQuantity: 2,
        offerQuantity: 2,
        hubPriceCents: 1200,
        offerPriceCents: 1200,
      })
    ).toBe(false);
  });

  it("keeps Hub variation option rows when Custom Label is blank or hyphenated", () => {
    expect(
      selectEbayHubCatchupOptionRows([
        { options: { Color: "Blue", Size: "Small" }, quantity: 5, priceCents: 500 },
        {
          sku: "cmt7vumcl000dxjujvgwe8dob-Purple",
          options: { Color: "Purple", Size: "Large" },
          quantity: 7,
        },
        { sku: "inw407217102811v1", options: { Color: "Red", Size: "Small" }, quantity: 5 },
      ])
    ).toEqual([
      {
        sku: null,
        options: { Color: "Blue", Size: "Small" },
        quantity: 5,
        priceCents: 500,
      },
      {
        sku: null,
        options: { Color: "Purple", Size: "Large" },
        quantity: 7,
        priceCents: null,
      },
      {
        sku: "inw407217102811v1",
        options: { Color: "Red", Size: "Small" },
        quantity: 5,
        priceCents: null,
      },
    ]);
    expect(
      ebayCatchupVariantAddress({
        hubSku: "cmt7vumcl000dxjujvgwe8dob-Purple",
        livePin: "407217102811abc",
      })
    ).toBe("407217102811abc");
    expect(
      ebayCatchupVariantAddress({
        hubSku: "inw407217102811",
        mappedPin: "407217102811abc",
      })
    ).toBe("407217102811abc");
    expect(
      ebayCatchupVariantAddress({
        hubSku: "inw407217102811",
        livePin: "inw407217102811",
        parentSku: "inw407217102811",
      })
    ).toBeNull();
    expect(
      ebayCatchupVariantAddress({
        hubSku: "inw407217102811",
        livePin: "inw407217102811v3",
        parentSku: "inw407217102811",
      })
    ).toBe("inw407217102811v3");
  });

  it("builds a bulk_update body with Hub quantity and optional price, never omitting offerId", () => {
    expect(
      buildEbayBulkUpdatePriceQuantityRequest({
        sku: "cmt123",
        offerId: "offer-9",
        quantity: 7,
        priceCents: 4400,
        currency: "USD",
        priceValue: "44.00",
      })
    ).toEqual({
      requests: [
        {
          sku: "cmt123",
          shipToLocationAvailability: { quantity: 7 },
          offers: [
            {
              offerId: "offer-9",
              availableQuantity: 7,
              price: { currency: "USD", value: "44.00" },
            },
          ],
        },
      ],
    });
    expect(
      buildEbayBulkUpdatePriceQuantityRequest({
        sku: "cmt123",
        offerId: "offer-9",
        quantity: 7,
        priceCents: null,
        currency: "USD",
        priceValue: null,
      }).requests[0]?.offers
    ).toEqual([{ offerId: "offer-9", availableQuantity: 7 }]);
  });

  it("reads per-SKU bulk_update errors from an HTTP 200 envelope", () => {
    expect(
      ebayBulkUpdateResponseFailed(
        {
          responses: [
            {
              sku: "cmt123",
              statusCode: 400,
              errors: [{ message: "Offer not found" }],
            },
          ],
        },
        "cmt123"
      )
    ).toBe("Offer not found");
    expect(ebayBulkUpdateResponseFailed({ responses: [{ statusCode: 200, sku: "cmt123" }] }, "cmt123")).toBeNull();
    expect(ebayBulkUpdateResponseFailed({ responses: [] }, "cmt123")).toBe(
      "bulk_update_price_quantity returned no per-SKU responses for cmt123"
    );
    expect(ebayBulkUpdateResponseFailed(null, "cmt123")).toBe(
      "bulk_update_price_quantity returned empty body for cmt123"
    );
  });

  it("treats warehouse lag as catch-up even when offer already matches Hub", () => {
    const surfaces = buildEbayQtyPriceSurfaces({
      hubQuantity: 7,
      viewItemQuantity: 3,
      offerQuantity: 7,
      warehouseQuantity: 3,
      inwQuantity: 3,
      hubPriceCents: 1200,
      offerPriceCents: 1200,
      inwPriceCents: 1200,
    });
    expect(ebayCatchupShouldWrite(surfaces)).toBe(true);
    expect(
      ebayCatchupShouldWriteVariantRow({
        hubQuantity: 7,
        offerQuantity: 7,
        warehouseQuantity: 3,
        hubPriceCents: 1200,
        offerPriceCents: 1200,
      })
    ).toBe(true);
  });
});
