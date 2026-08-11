import { describe, expect, it } from "vitest";
import { resolveInwCategoryFromRemote } from "./category-resolver";

describe("resolveInwCategoryFromRemote — Etsy auto-translate", () => {
  it("maps Etsy top-level Home & Living", () => {
    const r = resolveInwCategoryFromRemote("Home & Living", "Wall Decor", { provider: "etsy" });
    expect(r?.matchedPreset).toBe(true);
    expect(r?.category).toBe("Home & Living");
  });

  it("maps Etsy Jewelry → Jewelry & Watches", () => {
    const r = resolveInwCategoryFromRemote("Jewelry", "Earrings", { provider: "etsy" });
    expect(r?.category).toBe("Jewelry & Watches");
    expect(r?.subcategory).toBe("Earrings");
  });

  it("maps Etsy Paper & Party Supplies", () => {
    const r = resolveInwCategoryFromRemote("Paper & Party Supplies", "Greeting Cards", {
      provider: "etsy",
    });
    expect(r?.category).toBe("Paper & Party Supplies");
    expect(r?.subcategory).toBe("Greeting Cards");
  });

  it("maps Etsy Weddings → Wedding", () => {
    const r = resolveInwCategoryFromRemote("Weddings", null, { provider: "etsy" });
    expect(r?.category).toBe("Wedding");
  });

  it("maps Etsy Books, Films & Music", () => {
    const r = resolveInwCategoryFromRemote("Books, Films & Music", null, { provider: "etsy" });
    expect(r?.category).toBe("Books, Movies & Music");
  });

  it("picks closest preset for unfamiliar leaf labels", () => {
    const r = resolveInwCategoryFromRemote("Accessories", "Fascinators", { provider: "etsy" });
    expect(r?.matchedPreset).toBe(true);
    expect(r?.category).toBe("Accessories");
  });
});

describe("resolveInwCategoryFromRemote — Wix auto-translate", () => {
  it("ignores productType physical", () => {
    const r = resolveInwCategoryFromRemote("physical", null, { provider: "wix" });
    expect(r).toBeNull();
  });

  it("maps Wix collection Jewelry", () => {
    const r = resolveInwCategoryFromRemote("Jewelry", null, { provider: "wix" });
    expect(r?.category).toBe("Jewelry & Watches");
  });

  it("maps Wix apparel → Clothing", () => {
    const r = resolveInwCategoryFromRemote("Apparel", null, { provider: "wix" });
    expect(r?.category).toBe("Clothing");
  });

  it("ignores marketing collections via noise when only label", () => {
    const r = resolveInwCategoryFromRemote("New Arrivals", null, { provider: "wix" });
    expect(r).toBeNull();
  });

  it("closest-matches a ribbon like Skin Care", () => {
    const r = resolveInwCategoryFromRemote("Skin Care", null, { provider: "wix" });
    expect(r?.matchedPreset).toBe(true);
    expect(r?.category).toBe("Bath & Beauty");
    expect(r?.subcategory).toBe("Skin Care");
  });
});

describe("resolveInwCategoryFromRemote — eBay auto-translate", () => {
  it("maps eBay women's clothing path", () => {
    const r = resolveInwCategoryFromRemote(
      "Clothing, Shoes & Accessories > Women's Clothing",
      null,
      { provider: "ebay" }
    );
    expect(r?.matchedPreset).toBe(true);
    expect(r?.category).toBe("Clothing");
    expect(r?.subcategory).toBe("Women's Clothing");
  });

  it("maps eBay coins path to Art & Collectibles", () => {
    const r = resolveInwCategoryFromRemote(
      "Coins & Paper Money > Coins: US",
      null,
      { provider: "ebay" }
    );
    expect(r?.category).toBe("Art & Collectibles");
    expect(r?.subcategory).toBe("Coins & Currency");
  });

  it("maps eBay Home & Garden decor via closest preset", () => {
    const r = resolveInwCategoryFromRemote("Home & Garden > Home Décor", null, {
      provider: "ebay",
    });
    expect(r?.matchedPreset).toBe(true);
    expect(r?.category).toBe("Home & Living");
  });

  it("maps eBay Business & Industrial root", () => {
    const r = resolveInwCategoryFromRemote("Business & Industrial", null, { provider: "ebay" });
    expect(r?.category).toBe("Business & Industrial");
  });

  it("maps eBay tickets root", () => {
    const r = resolveInwCategoryFromRemote("Tickets & Experiences", null, { provider: "ebay" });
    expect(r?.category).toBe("Tickets & Experiences");
  });
});
