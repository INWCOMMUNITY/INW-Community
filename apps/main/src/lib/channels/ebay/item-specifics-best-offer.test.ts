import { describe, expect, it } from "vitest";
import { parseEbayBestOffer } from "./item-specifics";

describe("parseEbayBestOffer", () => {
  it("parses enabled best offer with minimum price", () => {
    const xml = `
      <Item>
        <BestOfferDetails>
          <BestOfferEnabled>true</BestOfferEnabled>
        </BestOfferDetails>
        <ListingDetails>
          <MinimumBestOfferPrice>80.00</MinimumBestOfferPrice>
        </ListingDetails>
      </Item>`;
    expect(parseEbayBestOffer(xml)).toEqual({ acceptOffers: true, minOfferCents: 8000 });
  });

  it("returns disabled when BestOfferEnabled is false", () => {
    const xml = `
      <Item>
        <BestOfferDetails>
          <BestOfferEnabled>false</BestOfferEnabled>
        </BestOfferDetails>
        <ListingDetails>
          <MinimumBestOfferPrice>80.00</MinimumBestOfferPrice>
        </ListingDetails>
      </Item>`;
    expect(parseEbayBestOffer(xml)).toEqual({ acceptOffers: false, minOfferCents: null });
  });
});
