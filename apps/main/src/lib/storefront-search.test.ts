import { describe, expect, it } from "vitest";
import {
  hasExactTitleMatch,
  normalizeStorefrontSearch,
  sortByStorefrontSearchRelevance,
  storefrontCloseMatchNote,
  storefrontSearchTier,
} from "./storefront-search";

describe("normalizeStorefrontSearch", () => {
  it("trims and collapses spaces", () => {
    expect(normalizeStorefrontSearch("  Batman   comic  ")).toBe("Batman comic");
  });
});

describe("storefrontSearchTier", () => {
  it("matches title case-insensitively", () => {
    expect(storefrontSearchTier({ title: "Batman #12" }, "batman")).toBe("title");
  });

  it("ranks category below title", () => {
    expect(
      storefrontSearchTier(
        { title: "Vintage print", category: "Comics", description: null },
        "comics"
      )
    ).toBe("category");
  });

  it("matches secondary category and subcategory", () => {
    expect(
      storefrontSearchTier({ title: "Poster", secondaryCategory: "Comics" }, "comics")
    ).toBe("category");
    expect(
      storefrontSearchTier({ title: "Poster", subcategory: "Superhero" }, "superhero")
    ).toBe("category");
  });

  it("ranks description last", () => {
    expect(
      storefrontSearchTier(
        { title: "Print", category: "Art", description: "Featuring Batman" },
        "batman"
      )
    ).toBe("description");
  });
});

describe("sortByStorefrontSearchRelevance", () => {
  it("orders title matches before category and description", () => {
    const sorted = sortByStorefrontSearchRelevance(
      [
        { title: "Art print", description: "Batman cameo", createdAt: "2026-01-01" },
        { title: "Poster", category: "Batman merch", createdAt: "2026-01-02" },
        { title: "Batman comic", createdAt: "2026-01-03" },
      ],
      "batman"
    );
    expect(sorted.map((i) => i.title)).toEqual(["Batman comic", "Poster", "Art print"]);
  });

  it("keeps price sort within the same tier", () => {
    const sorted = sortByStorefrontSearchRelevance(
      [
        { title: "Batman cheap", priceCents: 800 },
        { title: "Batman deluxe", priceCents: 2000 },
      ],
      "batman",
      "price_asc"
    );
    expect(sorted.map((i) => i.title)).toEqual(["Batman cheap", "Batman deluxe"]);
  });
});

describe("hasExactTitleMatch and close-match note", () => {
  it("detects a title substring match", () => {
    expect(hasExactTitleMatch([{ title: "1977 Batman" }], "batman")).toBe(true);
    expect(hasExactTitleMatch([{ title: "Vintage print" }], "batman")).toBe(false);
  });

  it("returns the close-match note only when results exist without a title hit", () => {
    expect(storefrontCloseMatchNote("batman", [])).toBeNull();
    expect(storefrontCloseMatchNote("batman", [{ title: "Batman comic" }])).toBeNull();
    expect(storefrontCloseMatchNote("batman", [{ title: "Vintage print" }])).toBe(
      'No exact matches for "batman", these might be close!'
    );
  });
});
