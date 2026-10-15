import { describe, expect, it } from "vitest";
import { explainEtsyMarketplaceRejection, sellerEtsyErrorMessage } from "./marketplace-rejection";

const RAW =
  'Etsy API 400: [{"path":"/marketplace","type":"invalid_marketplace","message":"Oh dear, you cannot sell this item on Etsy.","transformed":false}]';

describe("explainEtsyMarketplaceRejection", () => {
  it("explains a resale item that is too new to be vintage", () => {
    const message = explainEtsyMarketplaceRejection(RAW, {
      whoMade: "someone_else",
      whenMade: "2010_2019",
      isSupply: false,
    });
    expect(message).toContain("Another company made it");
    expect(message).toContain("not vintage");
    expect(message).toContain("production partner");
    expect(message).toContain("Drafts on INW");
    expect(message).toContain("do not need to fill it out again");
    expect(message).toContain("Add a production partner in your Etsy shop");
    expect(message).toContain("open this same draft on INW and choose List on Etsy");
    expect(message).toContain("start syncing this listing");
    expect(message).toContain("you do not need to import it");
    expect(message).toContain("publish it there");
    expect(message).not.toContain("invalid_marketplace");
  });

  it("still tells the seller what to change when How it's made is unknown", () => {
    const message = explainEtsyMarketplaceRejection(RAW);
    expect(message).toContain("vintage item about 20 years");
    expect(message).toContain("try List on Etsy again");
  });

  it("leaves unrelated Etsy errors alone", () => {
    expect(sellerEtsyErrorMessage("Etsy API 400: invalid taxonomy_id")).toBe(
      "Etsy API 400: invalid taxonomy_id"
    );
    expect(sellerEtsyErrorMessage(null)).toBeNull();
  });
});
