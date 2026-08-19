import { describe, expect, it } from "vitest";
import {
  buildPassthroughInventoryBody,
  buildPassthroughLiveOverlayBody,
  buildPassthroughOfferBody,
  buildPassthroughTitleInventoryBody,
  detectLivePassthroughChanges,
  detectPassthroughChangedFields,
  formatPassthroughFieldSyncSummary,
  formatPassthroughPutNote,
  formatPushedAspectsSummary,
  needsInventoryPut,
  overlayPassthroughOffer,
  passthroughSyncHasFailures,
  resolvePassthroughChanges,
} from "./passthrough-push";
import { storeItemContentHash } from "../sync-baseline";
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
      Certification: ["NGC (Numismatic Guaranty Corporation)"],
      Grade: ["MS 67"],
      "Letter grade": ["MS"],
      "Numerical grade": ["67"],
      Year: ["1938"],
      Denomination: ["5C"],
      Country: ["United States"],
    },
  },
};

const FULL_NGC = "NGC (Numismatic Guaranty Corporation)";

describe("passthrough-push", () => {
  it("builds wire aspects from GetItem when live inventory GET is empty (403004607151)", () => {
    const liveEmptyInventory = { condition: "LIKE_NEW", product: { title: coinItem.title } };
    const jeffersonGetItemTrading = {
      "Country of Origin": ["United States"],
      Coin: ["Jefferson Nickel"],
      Certification: ["NGC (Numismatic Guaranty Corporation)"],
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
    expect(aspects["Professional grader"]).toEqual([FULL_NGC]);
    expect(aspects["Letter grade"]).toEqual(["MS"]);
    expect(aspects["Numerical grade"]).toEqual(["67"]);
    expect(aspects.Grade).toBeUndefined();
    expect(aspects.Certification).toBeUndefined();
  });

  it("preserves live aspects and repairs wire keys when overlaying INW title", () => {
    const changed = { content: true, quantity: true, price: true, title: true };
    const nickelTaxonomy = [
      { name: "Professional grader", required: true, mode: "SELECTION_ONLY" as const, cardinality: "SINGLE" as const, suggestedValues: ["NGC", "PCGS"] },
      { name: "Grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
      { name: "Letter grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
      { name: "Numerical grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
    ];
    const body = buildPassthroughInventoryBody(liveJeffersonNickel, coinItem, changed, {
      categoryAspects: nickelTaxonomy,
    });

    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Letter grade"]).toEqual(["MS"]);
    expect(aspects["Numerical grade"]).toEqual(["67"]);
    expect(aspects["Professional grader"]).toEqual(["NGC"]);
    expect(aspects.Certification).toBeUndefined();
    expect(aspects.Grade).toEqual(["MS 67"]);

    expect((body.product as Record<string, unknown>).title).toBe(coinItem.title);
    expect(body.availability).toEqual({ shipToLocationAvailability: { quantity: 1 } });
    expect(body.condition).toBe("LIKE_NEW");
  });

  it("derives Letter grade prefix MS and Numerical grade 67 from Grade MS 67", () => {
    const liveStaleLetter = {
      product: {
        aspects: {
          Certification: ["NGC (Numismatic Guaranty Corporation)"],
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
    expect(aspects["Professional grader"]).toEqual([FULL_NGC]);
  });

  it("injects Numerical and Letter grade from GetItem when live inventory omits both", () => {
    const liveWithoutLetter = {
      condition: "LIKE_NEW",
      product: {
        aspects: {
          Certification: ["NGC (Numismatic Guaranty Corporation)"],
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
    expect(aspects["Professional grader"]).toEqual([FULL_NGC]);
    expect(aspects.Certification).toBeUndefined();
    expect(aspects["Letter grade"]).toEqual(["MS"]);
    expect(aspects["Numerical grade"]).toEqual(["67"]);
    expect(aspects.Grade).toBeUndefined();
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
      tradingAspects: { Certification: ["NGC (Numismatic Guaranty Corporation)"], Grade: ["PR 69"] },
      enrichAspects: true,
    });
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Professional grader"]).toEqual([FULL_NGC]);
    expect(aspects["Numerical grade"]).toEqual(["69"]);
    expect(aspects["Letter grade"]).toEqual(["69"]);
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
      tradingAspects: { Certification: ["NGC (Numismatic Guaranty Corporation)"] },
      enrichAspects: true,
    });
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Professional grader"]).toEqual([FULL_NGC]);
    expect(aspects.Certification).toBeUndefined();
    expect(aspects["Letter grade"]).toEqual(["MS"]);
    expect(aspects["Numerical grade"]).toEqual(["67"]);
  });

  it("never sends raw Certification when enrich must translate for Inventory PUT", () => {
    const liveOnlyCertification = {
      product: {
        title: "1938 Jefferson Nickel NGC MS 67",
        aspects: {
          Certification: ["NGC (Numismatic Guaranty Corporation)"],
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
    expect(aspects["Professional grader"]).toEqual([FULL_NGC]);
    expect(aspects.Certification).toBeUndefined();
  });

  it("maps Certification to Professional grader for Inventory PUT", () => {
    const liveTradingNames = {
      product: {
        aspects: {
          Certification: ["NGC (Numismatic Guaranty Corporation)"],
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
    expect(aspects["Professional grader"]).toEqual([FULL_NGC]);
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

  it("needsInventoryPut only for photo changes, not title or description", () => {
    expect(needsInventoryPut({ content: false, quantity: true, price: true, title: false, photos: false })).toBe(false);
    expect(needsInventoryPut({ content: true, quantity: false, price: false, title: true, photos: false })).toBe(false);
    expect(needsInventoryPut({ content: true, quantity: false, price: false, title: false, photos: true })).toBe(true);
    expect(needsInventoryPut({ content: true, quantity: false, price: false, title: false, photos: false, description: true })).toBe(false);
  });

  it("detectLivePassthroughChanges uses inventory PUT only when photos changed", () => {
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
    expect(needsInventoryPut(changed)).toBe(true);
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

  it("resolvePassthroughChanges pushes description when INW edited since last push", () => {
    const item = { ...coinItem, description: "<p>Updated copy</p>" };
    const previousHash = storeItemContentHash({ ...coinItem, description: "<p>Old copy</p>" });
    const inwFields = {
      title: false,
      description: storeItemContentHash(item) !== previousHash &&
        storeItemContentHash({ ...item, description: "" }) !== previousHash,
      photos: false,
      price: false,
    };
    expect(inwFields.description).toBe(true);

    const live = {
      title: false,
      photos: false,
      description: false,
      quantity: false,
      price: false,
      content: false,
    };
    const changed = resolvePassthroughChanges(live, inwFields, {
      syncTitles: true,
      syncDescriptions: true,
      syncPhotos: true,
      syncPrices: true,
    });
    expect(changed.description).toBe(true);
    expect(changed.title).toBe(false);
    expect(needsInventoryPut(changed)).toBe(false);
  });

  it("buildPassthroughTitleInventoryBody changes title with prepared aspects", () => {
    const live = {
      condition: "LIKE_NEW",
      availability: { shipToLocationAvailability: { quantity: 1 } },
      product: {
        title: "Old Title",
        aspects: {
          Grade: ["MS 67"],
          "Letter grade": ["MS"],
          "Numerical grade": ["67"],
          "Professional grader": ["NGC (Numismatic Guaranty Corporation)"],
        },
        imageUrls: ["https://i.ebayimg.com/a.jpg"],
      },
    };
    const body = buildPassthroughTitleInventoryBody(live, {
      ...coinItem,
      title: "New Title From INW",
    });
    const product = body.product as Record<string, unknown>;
    expect(product.title).toBe("New Title From INW");
    const aspects = product.aspects as Record<string, string[]>;
    expect(aspects["Letter grade"]).toEqual(["MS"]);
    expect(aspects["Numerical grade"]).toEqual(["67"]);
    expect(product.imageUrls).toEqual(["https://i.ebayimg.com/a.jpg"]);
    expect(body.condition).toBe("LIKE_NEW");
    expect(body.availability).toEqual({ shipToLocationAvailability: { quantity: 1 } });
  });

  it("buildPassthroughTitleInventoryBody includes Professional grader when live GET only has Composition and Mint", () => {
    const nickelTaxonomy = [
      { name: "Professional grader", required: true, mode: "SELECTION_ONLY" as const, cardinality: "SINGLE" as const, suggestedValues: ["NGC", "PCGS"] },
      { name: "Letter grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
      { name: "Numerical grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
      { name: "Grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
      { name: "Year", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
    ];
    const live = {
      condition: "LIKE_NEW",
      product: {
        title: "1938 Jefferson Nickel NGC MS 67",
        aspects: { Composition: ["Copper-Nickel"], Mint: ["Denver"] },
      },
    };
    const body = buildPassthroughTitleInventoryBody(live, coinItem, {
      categoryId: 41087,
      tradingAspects: {
        Certification: ["NGC (Numismatic Guaranty Corporation)"],
        Grade: ["MS 67"],
        Year: ["1938"],
        "Strike Type": ["Business"],
      },
      categoryAspects: nickelTaxonomy,
    });
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Professional grader"]).toEqual(["NGC"]);
    expect(aspects["Letter grade"]).toEqual(["MS"]);
    expect(aspects["Numerical grade"]).toEqual(["67"]);
    expect(aspects.Year).toEqual(["1938"]);
    expect(aspects.Composition).toEqual(["Copper-Nickel"]);
    expect(aspects.Certification).toBeUndefined();
  });

  it("buildPassthroughTitleInventoryBody keeps Letter grade for 41087 when taxonomy has Numerical but omits Letter", () => {
    const nickel41087Taxonomy = [
      { name: "Professional grader", required: true, mode: "SELECTION_ONLY" as const, cardinality: "SINGLE" as const, suggestedValues: ["NGC", "PCGS"] },
      { name: "Grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
      { name: "Numerical grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
      { name: "Year", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
    ];
    const live = {
      condition: "LIKE_NEW",
      product: {
        title: "1938 Jefferson Nickel NGC MS 67",
        aspects: { Composition: ["Copper-Nickel"], Mint: ["Denver"] },
      },
    };
    const body = buildPassthroughTitleInventoryBody(live, coinItem, {
      categoryId: "41087",
      tradingAspects: { Certification: ["NGC (Numismatic Guaranty Corporation)"], Grade: ["MS 67"], Year: ["1938"] },
      categoryAspects: nickel41087Taxonomy,
    });
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Letter grade"]).toEqual(["MS"]);
    expect(aspects["Numerical grade"]).toEqual(["67"]);
    expect(aspects["Professional grader"]).toEqual(["NGC"]);
  });

  it("buildPassthroughTitleInventoryBody uses numeric Letter grade for dime 39458", () => {
    const dimeTaxonomy = [
      { name: "Professional grader", required: true, mode: "SELECTION_ONLY" as const, cardinality: "SINGLE" as const, suggestedValues: ["NGC", "PCGS"] },
      { name: "Numerical grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
      { name: "Grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
    ];
    const live = {
      condition: "LIKE_NEW",
      product: {
        title: "2002-S NGC PF 69 Ultra Cameo Roosevelt Dime",
        aspects: { Composition: ["Clad"], Year: ["2002"] },
      },
    };
    const body = buildPassthroughTitleInventoryBody(
      live,
      { ...coinItem, title: "2002-S NGC PF 69 Ultra Cameo Roosevelt Dime Revised" },
      {
        categoryId: "39458",
        tradingAspects: { Certification: ["NGC (Numismatic Guaranty Corporation)"], Grade: ["PR 69"], Year: ["2002"] },
        categoryAspects: dimeTaxonomy,
      }
    );
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Letter grade"]).toEqual(["69"]);
    expect(aspects["Numerical grade"]).toEqual(["69"]);
    expect(aspects["Professional grader"]).toEqual(["NGC"]);
  });

  it("buildPassthroughTitleInventoryBody backfills Letter and Numerical grade when live has grader+Grade but omits wire sub-fields", () => {
    const nickelTaxonomy = [
      { name: "Professional grader", required: true, mode: "SELECTION_ONLY" as const, cardinality: "SINGLE" as const, suggestedValues: ["NGC", "PCGS"] },
      { name: "Letter grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
      { name: "Numerical grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
      { name: "Grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
    ];
    const live = {
      condition: "LIKE_NEW",
      product: {
        title: "1938 Jefferson Nickel NGC MS 67",
        aspects: {
          "Professional grader": ["NGC (Numismatic Guaranty Corporation)"],
          Grade: ["MS 67"],
          Composition: ["Copper-Nickel"],
        },
      },
    };
    const body = buildPassthroughTitleInventoryBody(live, coinItem, { categoryAspects: nickelTaxonomy });
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Letter grade"]).toEqual(["MS"]);
    expect(aspects["Numerical grade"]).toEqual(["67"]);
  });

  it("buildPassthroughTitleInventoryBody backfills Year from GetItem when live GET omits it", () => {
    const live = {
      condition: "LIKE_NEW",
      product: {
        title: "1938 Jefferson Nickel NGC MS 67",
        aspects: {
          Grade: ["MS 67"],
          "Professional grader": ["NGC (Numismatic Guaranty Corporation)"],
          "Letter grade": ["MS"],
          "Numerical grade": ["67"],
        },
      },
    };
    const body = buildPassthroughTitleInventoryBody(live, coinItem, {
      tradingAspects: { Year: ["1938"] },
    });
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects.Year).toEqual(["1938"]);
  });

  it("formatPassthroughFieldSyncSummary reports partial sync outcomes", () => {
    const summary = formatPassthroughFieldSyncSummary([
      { field: "price", ok: true },
      { field: "title", ok: false, error: "#25002 Year is missing" },
      { field: "description", ok: true },
    ]);
    expect(summary).toContain("price: updated");
    expect(summary).toContain("title: failed");
    expect(summary).toContain("description: updated");
    expect(passthroughSyncHasFailures([
      { field: "price", ok: true },
      { field: "title", ok: false, error: "x" },
    ])).toBe(true);
  });

  it("resolvePassthroughChanges pushes title without requiring photo inventory PUT", () => {
    const item = { ...coinItem, title: "1938 Jefferson Nickel NGC MS 67 Revised" };
    const previousHash = storeItemContentHash(coinItem);
    const inwFields = {
      title: storeItemContentHash(item) !== previousHash,
      description: false,
      photos: false,
      price: false,
    };
    const changed = resolvePassthroughChanges(
      {
        title: false,
        photos: false,
        description: false,
        quantity: false,
        price: false,
        content: false,
      },
      inwFields,
      {
        syncTitles: true,
        syncDescriptions: true,
        syncPhotos: true,
        syncPrices: true,
      }
    );
    expect(changed.title).toBe(true);
    expect(needsInventoryPut(changed)).toBe(false);
  });

  it("buildPassthroughLiveOverlayBody omits aspects on photo-only PUT", () => {
    const live = {
      condition: "LIKE_NEW",
      availability: { shipToLocationAvailability: { quantity: 1 } },
      product: {
        title: "Keep Title",
        aspects: { Grade: ["MS 67"], "Numerical grade": ["67"] },
        imageUrls: ["https://i.ebayimg.com/old.jpg"],
      },
    };
    const body = buildPassthroughLiveOverlayBody(live, {
      imageUrls: ["https://i.ebayimg.com/new.jpg"],
    });
    const product = body.product as Record<string, unknown>;
    expect(product.imageUrls).toEqual(["https://i.ebayimg.com/new.jpg"]);
    expect(product.title).toBe("Keep Title");
    expect(product.aspects).toEqual({ Grade: ["MS 67"], "Numerical grade": ["67"] });
  });

  it("formatPassthroughPutNote reports preserved aspects", () => {
    expect(
      formatPassthroughPutNote({
        product: { title: "T", aspects: { Year: ["1938"] }, imageUrls: [] },
      })
    ).toContain("Year");
  });

  it("formatPushedAspectsSummary includes wire keys", () => {
    expect(
      formatPushedAspectsSummary({
        Grade: ["MS 67"],
        "Professional grader": ["NGC (Numismatic Guaranty Corporation)"],
        "Letter grade": ["MS"],
        "Numerical grade": ["67"],
      })
    ).toContain("Grader=NGC");
  });

  it("repairs live Letter grade=69 when title push requires inventory PUT", () => {
    const liveBadWire = {
      condition: "LIKE_NEW",
      product: {
        title: "2002-S NGC PF 69 Ultra Cameo Roosevelt Dime",
        aspects: {
          "Professional grader": ["NGC (Numismatic Guaranty Corporation)"],
          Grade: ["PR 69"],
          "Letter grade": ["69"],
          "Numerical grade": ["69"],
          Year: ["2002"],
        },
      },
    };
    const dimeTaxonomy = [
      { name: "Professional grader", required: true, mode: "SELECTION_ONLY" as const, cardinality: "SINGLE" as const, suggestedValues: ["NGC", "PCGS"] },
      { name: "Numerical grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
      { name: "Grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
    ];
    const body = buildPassthroughInventoryBody(
      liveBadWire,
      { ...coinItem, title: "2002-S NGC PR 69 Ultra Cameo Roosevelt Dime Revised" },
      { content: true, title: true, quantity: false, price: false },
      { categoryId: "39458", categoryAspects: dimeTaxonomy }
    );
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Letter grade"]).toEqual(["69"]);
    expect(aspects["Numerical grade"]).toEqual(["69"]);
    expect(aspects["Professional grader"]).toEqual(["NGC"]);
  });

  it("matches user-reported live inventory aspects with wire repair on title PUT", () => {
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
    const nickelTaxonomy = [
      { name: "Professional grader", required: true, mode: "SELECTION_ONLY" as const, cardinality: "SINGLE" as const, suggestedValues: ["NGC", "PCGS"] },
      { name: "Letter grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
      { name: "Numerical grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
      { name: "Grade", required: true, mode: "FREE_TEXT" as const, cardinality: "SINGLE" as const, suggestedValues: [] },
    ];
    const body = buildPassthroughInventoryBody(
      liveLikeProduction,
      coinItem,
      { content: true, quantity: true, price: true, title: true },
      { categoryAspects: nickelTaxonomy }
    );
    const aspects = (body.product as Record<string, unknown>).aspects as Record<string, string[]>;
    expect(aspects["Professional grader"]).toEqual(["NGC"]);
    expect(aspects["Letter grade"]).toEqual(["MS"]);
    expect(aspects["Numerical grade"]).toEqual(["67"]);
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
