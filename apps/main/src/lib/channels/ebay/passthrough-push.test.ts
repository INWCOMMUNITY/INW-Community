import { describe, expect, it } from "vitest";
import {
  buildPassthroughInventoryBody,
  buildPassthroughOfferBody,
  detectPassthroughChangedFields,
} from "./passthrough-push";
import type { SyncStoreItem } from "../types";
import { syncContentHash } from "../sync-baseline";

const coinItem = {
  id: "cmsz85hpj0001ahwfa2pmvtun",
  title: "1938 Jefferson Nickel NGC MS 67",
  description: "<p>Beautiful coin</p>",
  priceCents: 12500,
  quantity: 1,
  photos: ["https://example.com/coin.jpg"],
  condition: "used",
  ebayConditionEnum: null,
  ebayCategoryId: 41087,
  aspects: [],
  variants: null,
  category: null,
  status: "active",
  sku: null,
} satisfies SyncStoreItem;

const liveJeffersonNickel = {
  condition: "LIKE_NEW",
  availability: { shipToLocationAvailability: { quantity: 1 } },
  product: {
    title: "1938 Jefferson Nickel NGC MS 67",
    description: "Original eBay description",
    imageUrls: ["https://i.ebayimg.com/original.jpg"],
    aspects: {
      Certification: ["NGC"],
      Grade: ["MS 67"],
      "Letter grade": ["MS"],
      "Numerical grade": ["67"],
      Year: ["1938"],
      Denomination: ["5C"],
      Country: ["United States"],
    },
  },
};

describe("passthrough-push", () => {
  it("preserves live aspects verbatim when overlaying INW title and qty", () => {
    const changed = { content: true, quantity: true, price: true };
    const body = buildPassthroughInventoryBody(liveJeffersonNickel, coinItem, changed);

    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Letter grade"]).toEqual(["MS"]);
    expect(aspects["Numerical grade"]).toEqual(["67"]);
    expect(aspects.Certification).toEqual(["NGC"]);
    expect(aspects.Grade).toEqual(["MS 67"]);

    expect((body.product as Record<string, unknown>).title).toBe(coinItem.title);
    expect(body.availability).toEqual({ shipToLocationAvailability: { quantity: 1 } });
    expect(body.condition).toBe("LIKE_NEW");
  });

  it("injects Letter grade when live GET omits it but Grade and Certification present", () => {
    const liveWithoutLetter = {
      condition: "LIKE_NEW",
      product: {
        aspects: {
          Certification: ["NGC"],
          Grade: ["MS 67"],
          Year: ["1938"],
        },
      },
    };
    const body = buildPassthroughInventoryBody(liveWithoutLetter, coinItem, {
      content: true,
      quantity: true,
      price: true,
    });
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Letter grade"]).toEqual(["67"]);
    expect(aspects["Numerical grade"]).toEqual(["67"]);
    expect(aspects.Grade).toEqual(["MS 67"]);
  });

  it("qty-only overlay leaves product content untouched", () => {
    const changed = { content: false, quantity: true, price: false };
    const body = buildPassthroughInventoryBody(
      liveJeffersonNickel,
      { ...coinItem, quantity: 0 },
      changed
    );

    const product = body.product as Record<string, unknown>;
    expect(product.title).toBe("1938 Jefferson Nickel NGC MS 67");
    expect(body.availability).toEqual({ shipToLocationAvailability: { quantity: 0 } });
  });

  it("buildPassthroughOfferBody updates price and qty", () => {
    const changed = { content: true, quantity: true, price: true };
    const offer = buildPassthroughOfferBody(
      { ...coinItem, priceCents: 15000, quantity: 2 },
      changed,
      { sku: "inw403004607151", format: "FIXED_PRICE" }
    );

    expect(offer.availableQuantity).toBe(2);
    expect((offer.pricingSummary as { price: { value: string } }).price.value).toBe("150.00");
    expect(offer.listingDescription).toContain("Beautiful coin");
  });

  it("detectPassthroughChangedFields uses baseline hash", () => {
    const hash = syncContentHash({
      title: coinItem.title,
      description: coinItem.description,
      priceCents: coinItem.priceCents,
      photos: coinItem.photos,
    });
    const unchanged = detectPassthroughChangedFields(coinItem, {
      syncBaselineHash: hash,
      syncBaselineQty: 1,
    });
    expect(unchanged.content).toBe(false);
    expect(unchanged.quantity).toBe(false);

    const qtyChanged = detectPassthroughChangedFields(
      { ...coinItem, quantity: 0 },
      { syncBaselineHash: hash, syncBaselineQty: 1 }
    );
    expect(qtyChanged.quantity).toBe(true);
    expect(qtyChanged.content).toBe(false);
  });
});
