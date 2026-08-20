import { describe, expect, it } from "vitest";
import { remoteTitleOrPriceDiffersFromStoreItem } from "./apply-remote-listing";

describe("remoteTitleOrPriceDiffersFromStoreItem", () => {
  const inw = {
    title: "United States Navy - Bureau of Ordnance / Tachometer w Case NICE!",
    priceCents: 5500,
  };

  it("detects an eBay-native title and price edit without a last-modified timestamp", () => {
    expect(
      remoteTitleOrPriceDiffersFromStoreItem(inw, {
        title: "United States Navy - Bureau of Ordnance / Tachometer w Case EBAY CRON TEST",
        priceCents: 6000,
      })
    ).toBe(true);
  });

  it("ignores photo/description-only drift (title and price match)", () => {
    expect(
      remoteTitleOrPriceDiffersFromStoreItem(inw, {
        title: inw.title,
        priceCents: 5500,
      })
    ).toBe(false);
  });

  it("does not treat eBay's 80-char title cap as an edit", () => {
    const long = "A".repeat(90);
    expect(
      remoteTitleOrPriceDiffersFromStoreItem(
        { title: long, priceCents: 1000 },
        { title: long.slice(0, 80), priceCents: 1000 }
      )
    ).toBe(false);
  });
});
