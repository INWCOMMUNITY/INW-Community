import { describe, expect, it } from "vitest";
import { importCategoryNeedsReview, resolveImportCategory } from "./import-listing";

describe("resolveImportCategory — eBay paths", () => {
  it("returns canonical category assignment for comic imports", async () => {
    const assignment = await resolveImportCategory({
      provider: "ebay",
      remoteLabel: "Collectibles > Comics > Modern Age (1992-Now)",
      remoteSubLabel: "Modern Age (1992-Now)",
      title: "Batman #423 CGC 9.6 White Pages",
    });
    expect(assignment).not.toBeNull();
    expect(assignment?.source).toBe("ebay_path");
    expect(assignment?.category).toBe("Books, Movies & Music");
    expect(assignment?.subcategory).toBe("Comics & Graphic Novels");
    expect(assignment?.matchedPreset).toBe(true);
  });

  it("returns coin subcategory for eBay coin paths", async () => {
    const assignment = await resolveImportCategory({
      provider: "ebay",
      remoteLabel: "Coins & Paper Money > Coins: US",
      remoteSubLabel: null,
      title: "1881-S Morgan Dollar MS65",
    });
    expect(assignment?.category).toBe("Art & Collectibles");
    expect(assignment?.subcategory).toBe("Coins & Currency");
  });

  it("uses title suggestion when remote category is missing", async () => {
    const assignment = await resolveImportCategory({
      provider: "ebay",
      remoteLabel: null,
      title: "Vintage Comic Book Amazing Fantasy #15",
      description: "Silver age comic book key issue",
    });
    expect(assignment?.source === "title_suggestion" || assignment?.source === "enhanced").toBe(true);
    expect(assignment?.category).toBeTruthy();
    expect(assignment?.subcategory).toBeTruthy();
  });
});

describe("resolveImportCategory — Shopify", () => {
  it("maps Standard Product Taxonomy paths to INW presets", async () => {
    const assignment = await resolveImportCategory({
      provider: "shopify",
      remoteLabel: "Apparel & Accessories > Clothing > Clothing Tops > T-Shirts",
      remoteSubLabel: "T-Shirts",
      title: "INW Community Logo Tee",
    });
    expect(assignment?.matchedPreset).toBe(true);
    expect(assignment?.category).toBe("Clothing");
    expect(assignment?.subcategory).toBe("Tops & Tees");
  });

  it("uses title suggestion when Shopify has no category signal", async () => {
    const assignment = await resolveImportCategory({
      provider: "shopify",
      remoteLabel: null,
      title: "Handmade lavender soap bar",
      description: "<p>Natural bath soap with essential oils</p>",
    });
    expect(assignment?.source === "title_suggestion" || assignment?.source === "enhanced").toBe(
      true
    );
    expect(assignment?.category).toBe("Bath & Beauty");
    expect(assignment?.matchedPreset).toBe(true);
    expect(assignment?.subcategory).toBeTruthy();
  });

  it("prefers title over a weak marketing collection label", async () => {
    const assignment = await resolveImportCategory({
      provider: "shopify",
      remoteLabel: "Summer Drop 2026",
      title: "PlayStation 5 game God of War",
      description: "Physical video game disc",
    });
    expect(assignment?.category).toBe("Video Games & Consoles");
    expect(assignment?.matchedPreset).toBe(true);
  });

  it("maps Shopify Home & Garden taxonomy to the INW garden preset", async () => {
    const assignment = await resolveImportCategory({
      provider: "shopify",
      remoteLabel: "Home & Garden > Plants",
      title: "Snake plant in ceramic pot",
    });
    expect(assignment?.category).toBe("Home & Garden");
    expect(assignment?.subcategory).toBe("Plants & Seeds");
    expect(assignment?.matchedPreset).toBe(true);
  });

  it("maps Shopify Sporting Goods camping path", async () => {
    const assignment = await resolveImportCategory({
      provider: "shopify",
      remoteLabel: "Sporting Goods > Outdoor Recreation > Camping & Hiking",
      title: "Two-person camping tent",
    });
    expect(assignment?.category).toBe("Sports & Outdoors");
    expect(assignment?.subcategory).toBe("Camping & Hiking");
  });

  it("maps Shopify Luggage & Bags to Luggage & Travel", async () => {
    const assignment = await resolveImportCategory({
      provider: "shopify",
      remoteLabel: "Luggage & Bags > Luggage",
      title: "Hardshell suitcase 28 inch",
    });
    expect(assignment?.category).toBe("Luggage & Travel");
    expect(assignment?.subcategory).toBe("Suitcases & Luggage");
  });
});

describe("resolveImportCategory — preset-only writes", () => {
  it("does not keep a junk remote label when the title has no category signal", async () => {
    const assignment = await resolveImportCategory({
      provider: "wix",
      remoteLabel: "Qxyzzy Blorpt Drop",
      title: "Item 42",
    });
    expect(assignment).toBeNull();
  });

  it("prefers title over an unmapped eBay label", async () => {
    const assignment = await resolveImportCategory({
      provider: "ebay",
      remoteLabel: "Qxyzzy Blorpt Drop",
      title: "Acoustic guitar with gig bag",
    });
    expect(assignment?.category).toBe("Musical Instruments");
    expect(assignment?.matchedPreset).toBe(true);
    expect(importCategoryNeedsReview(assignment)).toBe(true);
  });

  it("prefers title over an unmapped Etsy label", async () => {
    const assignment = await resolveImportCategory({
      provider: "etsy",
      remoteLabel: "Qxyzzy Blorpt Drop",
      title: "Handmade lavender soap bar",
    });
    expect(assignment?.category).toBe("Bath & Beauty");
    expect(importCategoryNeedsReview(assignment)).toBe(true);
  });

  it("flags title-based assignments for seller review", () => {
    expect(
      importCategoryNeedsReview({
        category: "Clothing",
        subcategory: "Tops & Tees",
        matchedPreset: true,
        score: 0.9,
        source: "title_suggestion",
      })
    ).toBe(true);
    expect(
      importCategoryNeedsReview({
        category: "Clothing",
        subcategory: "Tops & Tees",
        matchedPreset: true,
        source: "ebay_path",
      })
    ).toBe(false);
    expect(importCategoryNeedsReview(null)).toBe(true);
  });
});
