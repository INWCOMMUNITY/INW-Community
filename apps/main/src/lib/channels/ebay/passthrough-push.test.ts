import { describe, expect, it } from "vitest";
import {
  buildPassthroughInventoryBody,
  buildPassthroughOfferBody,
  detectLivePassthroughChanges,
  detectPassthroughChangedFields,
  formatPushedAspectsSummary,
  needsInventoryPut,
  overlayPassthroughOffer,
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
  it("builds wire aspects from GetItem when live inventory GET is empty (403004607151)", () => {
    const liveEmptyInventory = { condition: "LIKE_NEW", product: { title: coinItem.title } };
    const jeffersonGetItemTrading = {
      "Country of Origin": ["United States"],
      Coin: ["Jefferson Nickel"],
      Certification: ["NGC"],
      "Strike Type": ["Business"],
      "Mint Location": ["Denver"],
      Grade: ["MS 67"],
      Year: ["1938"],
      "Circulated/Uncirculated": ["Uncirculated"],
      Denomination: ["5C"],
    };
    const body = buildPassthroughInventoryBody(liveEmptyInventory, coinItem, {
      content: true,
      quantity: true,
      price: true,
    }, {
      tradingAspects: jeffersonGetItemTrading,
      enrichAspects: true,
    });
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Professional grader"]).toEqual(["NGC"]);
    expect(aspects["Letter grade"]).toEqual(["MS"]);
    expect(aspects["Numerical grade"]).toEqual(["67"]);
    expect(aspects.Grade).toEqual(["MS 67"]);
    expect(aspects.Certification).toBeUndefined();
  });

  it("preserves live aspects verbatim when overlaying INW title and qty", () => {
    const changed = { content: true, quantity: true, price: true, title: true };
    const body = buildPassthroughInventoryBody(liveJeffersonNickel, coinItem, changed);

    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Letter grade"]).toEqual(["MS"]);
    expect(aspects["Numerical grade"]).toEqual(["67"]);
    expect(aspects.Certification).toEqual(["NGC"]);
    expect(aspects["Professional grader"]).toBeUndefined();
    expect(aspects.Grade).toEqual(["MS 67"]);

    expect((body.product as Record<string, unknown>).title).toBe(coinItem.title);
    expect(body.availability).toEqual({ shipToLocationAvailability: { quantity: 1 } });
    expect(body.condition).toBe("LIKE_NEW");
  });

  it("derives Letter grade prefix MS and Numerical grade 67 from Grade MS 67", () => {
    const liveStaleLetter = {
      product: {
        aspects: {
          Certification: ["NGC"],
          Grade: ["MS 67"],
          "Letter grade": ["MS"],
          Year: ["1938"],
        },
      },
    };
    const body = buildPassthroughInventoryBody(liveStaleLetter, coinItem, {
      content: true,
      quantity: true,
      price: true,
    }, { enrichAspects: true });
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Letter grade"]).toEqual(["MS"]);
    expect(aspects["Numerical grade"]).toEqual(["67"]);
    expect(aspects["Professional grader"]).toEqual(["NGC"]);
  });

  it("injects Numerical and Letter grade from GetItem when live inventory omits both", () => {
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
    }, { enrichAspects: true });
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Professional grader"]).toEqual(["NGC"]);
    expect(aspects.Certification).toBeUndefined();
    expect(aspects["Letter grade"]).toEqual(["MS"]);
    expect(aspects["Numerical grade"]).toEqual(["67"]);
    expect(aspects.Grade).toEqual(["MS 67"]);
  });

  it("derives grade sub-fields for PR 69 dime from GetItem trading aspects", () => {
    const dimeItem = {
      ...coinItem,
      id: "cmszcc1qk0002paaut7jwo9oh",
      title: "2002-S NGC PF 69 Ultra Cameo Roosevelt Dime",
      ebayCategoryId: 39458,
    };
    const liveNoGrader = {
      product: {
        aspects: {
          Grade: ["PR 69"],
          Year: ["2002"],
        },
      },
    };
    const body = buildPassthroughInventoryBody(liveNoGrader, dimeItem, {
      content: true,
      quantity: true,
      price: true,
    }, {
      tradingAspects: { Certification: ["NGC"], Grade: ["PR 69"] },
      enrichAspects: true,
    });
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Professional grader"]).toEqual(["NGC"]);
    expect(aspects["Numerical grade"]).toEqual(["69"]);
    expect(aspects["Letter grade"]).toEqual(["PR"]);
  });

  it("uses GetItem Certification when live inventory omits grader fields", () => {
    const liveNoGrader = {
      product: {
        aspects: {
          Grade: ["MS 67"],
          Year: ["1938"],
        },
      },
    };
    const body = buildPassthroughInventoryBody(liveNoGrader, coinItem, {
      content: true,
      quantity: true,
      price: true,
    }, {
      tradingAspects: { Certification: ["NGC"] },
      enrichAspects: true,
    });
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Professional grader"]).toEqual(["NGC"]);
    expect(aspects.Certification).toBeUndefined();
    expect(aspects["Letter grade"]).toEqual(["MS"]);
    expect(aspects["Numerical grade"]).toEqual(["67"]);
  });

  it("never sends raw Certification when enrich must translate for Inventory PUT", () => {
    const liveOnlyCertification = {
      product: {
        title: "1938 Jefferson Nickel NGC MS 67",
        aspects: {
          Certification: ["NGC"],
          Grade: ["MS 67"],
          Year: ["1938"],
        },
      },
    };
    const body = buildPassthroughInventoryBody(
      liveOnlyCertification,
      { ...coinItem, aspects: [] },
      { content: true, quantity: true, price: true },
      { enrichAspects: true }
    );
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Professional grader"]).toEqual(["NGC"]);
    expect(aspects.Certification).toBeUndefined();
  });

  it("maps Certification to Professional grader for Inventory PUT", () => {
    const liveTradingNames = {
      product: {
        aspects: {
          Certification: ["NGC"],
          Grade: ["MS 67"],
          Year: ["1938"],
          "Circulated/Uncirculated": ["Uncirculated"],
        },
      },
    };
    const body = buildPassthroughInventoryBody(liveTradingNames, coinItem, {
      content: true,
      quantity: true,
      price: true,
    }, { enrichAspects: true });
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Professional grader"]).toEqual(["NGC"]);
    expect(aspects.Certification).toBeUndefined();
    expect(aspects["Circulated/Uncirculated"]).toEqual(["Uncirculated"]);
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

  it("keeps Certification when Professional grader cannot be derived", () => {
    const liveNoGrader = {
      product: {
        aspects: {
          Year: ["1938"],
          Denomination: ["5C"],
        },
      },
    };
    const body = buildPassthroughInventoryBody(
      liveNoGrader,
      { ...coinItem, title: "1938 Jefferson Nickel" },
      { content: true, quantity: false, price: false }
    );
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Professional grader"]).toBeUndefined();
    expect(aspects.Year).toEqual(["1938"]);
  });

  it("needsInventoryPut only for title changes", () => {
    expect(needsInventoryPut({ content: false, quantity: true, price: true, title: false, photos: false })).toBe(false);
    expect(needsInventoryPut({ content: true, quantity: false, price: false, title: true, photos: false })).toBe(true);
    expect(needsInventoryPut({ content: true, quantity: false, price: false, title: false, photos: true })).toBe(false);
    expect(needsInventoryPut({ content: true, quantity: false, price: false, title: false, photos: false, description: true })).toBe(false);
  });

  it("detectLivePassthroughChanges skips inventory when title matches even if photos differ by CDN URL", () => {
    const changed = detectLivePassthroughChanges(
      liveJeffersonNickel,
      { ...coinItem, photos: ["https://i.ebayimg.com/different-size.jpg"] },
      {
        listingDescription: "Original eBay description",
        pricingSummary: { price: { value: "125.00" } },
      }
    );
    expect(changed.title).toBe(false);
    expect(changed.photos).toBe(true);
    expect(needsInventoryPut(changed)).toBe(false);
  });

  it("overlayPassthroughOffer does not rewrite categoryId", () => {
    const offer = overlayPassthroughOffer(
      {
        categoryId: "39458",
        listingPolicies: { paymentPolicyId: "p1" },
        listingDescription: "old",
        offerId: "offer-1",
        status: "PUBLISHED",
      },
      coinItem,
      { content: true, quantity: false, price: false, description: true }
    );
    expect(offer.categoryId).toBe("39458");
    expect(offer.listingPolicies).toEqual({ paymentPolicyId: "p1" });
    expect(offer.offerId).toBeUndefined();
    expect(offer.listingDescription).toContain("Beautiful coin");
  });

  it("formatPushedAspectsSummary includes wire keys", () => {
    expect(
      formatPushedAspectsSummary({
        Grade: ["MS 67"],
        "Professional grader": ["NGC"],
        "Letter grade": ["MS"],
        "Numerical grade": ["67"],
      })
    ).toContain("Grader=NGC");
  });

  it("matches user-reported live inventory aspects verbatim without enrichment", () => {
    const liveLikeProduction = {
      product: {
        title: "1938 Jefferson Nickel NGC MS 67",
        aspects: {
          Composition: ["Copper-Nickel"],
          Mint: ["Denver"],
          "Letter grade": ["MS"],
          "Strike Type": ["Business"],
          Grade: ["MS 67"],
          Modified: ["No"],
        },
      },
    };
    const body = buildPassthroughInventoryBody(
      liveLikeProduction,
      coinItem,
      { content: true, quantity: true, price: true, title: false }
    );
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(Object.keys(aspects).sort()).toEqual([
      "Composition",
      "Grade",
      "Letter grade",
      "Mint",
      "Modified",
      "Strike Type",
    ]);
    expect(aspects["Professional grader"]).toBeUndefined();
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
