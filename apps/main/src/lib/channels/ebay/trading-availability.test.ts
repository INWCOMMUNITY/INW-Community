import { describe, expect, it } from "vitest";
import {
  ebayGetItemMarksInwSoldOut,
  ebayGetItemQtyIsUnsoldZero,
  parseEbayGetItemAvailability,
} from "./trading";

describe("parseEbayGetItemAvailability", () => {
  it("does not treat a variation with qty 0 as the whole listing being sold out", () => {
    const xml = `
      <Item>
        <Quantity>1</Quantity>
        <SellingStatus>
          <ListingStatus>Active</ListingStatus>
          <QuantitySold>0</QuantitySold>
        </SellingStatus>
        <Variations>
          <Variation>
            <Quantity>0</Quantity>
            <QuantityAvailable>0</QuantityAvailable>
          </Variation>
        </Variations>
      </Item>`;
    const parsed = parseEbayGetItemAvailability(xml);
    expect(parsed.listingEnded).toBe(false);
    expect(parsed.quantitySold).toBe(0);
    expect(parsed.quantity).toBe(1);
  });

  it("uses QuantityAvailable when present on the listing", () => {
    const xml = `
      <Item>
        <Quantity>3</Quantity>
        <QuantityAvailable>2</QuantityAvailable>
        <SellingStatus>
          <ListingStatus>Active</ListingStatus>
          <QuantitySold>1</QuantitySold>
        </SellingStatus>
      </Item>`;
    expect(parseEbayGetItemAvailability(xml).quantity).toBe(2);
  });
});

describe("ebayGetItemMarksInwSoldOut", () => {
  it("does not mark INW sold when the listing ended with no units sold", () => {
    expect(
      ebayGetItemMarksInwSoldOut({ listingEnded: true, quantitySold: 0, quantity: 0 })
    ).toBe(false);
  });

  it("marks INW sold when the listing ended after selling remaining stock", () => {
    expect(
      ebayGetItemMarksInwSoldOut({ listingEnded: true, quantitySold: 1, quantity: 0 })
    ).toBe(true);
  });
});

describe("ebayGetItemQtyIsUnsoldZero", () => {
  it("flags an active qty 0 read with no QuantitySold", () => {
    expect(
      ebayGetItemQtyIsUnsoldZero({ listingEnded: false, quantitySold: 0, quantity: 0 })
    ).toBe(true);
  });

  it("does not flag a real last-unit sale", () => {
    expect(
      ebayGetItemQtyIsUnsoldZero({ listingEnded: false, quantitySold: 1, quantity: 0 })
    ).toBe(false);
  });
});
