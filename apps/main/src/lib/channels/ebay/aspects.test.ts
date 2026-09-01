import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("database", () => ({
  prisma: {
    siteSetting: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { EbayApiError } from "./errors";
import {
  cacheCategoryAspects,
  cacheEbayCategorySearch,
  clearCategoryAspectCache,
  clearEbayCategorySearchCache,
  clearEbayCategoryTreeIdCache,
  clearEbayTaxonomyCooldown,
  getCachedCategoryAspects,
  getDefaultCategoryTreeId,
  getItemAspectsForCategory,
  markEbayTaxonomyRateLimited,
  parseAspectApiResponse,
  searchEbayCategories,
} from "./aspects";
import * as oauth from "./oauth";
import * as client from "./client";
import * as config from "./config";

describe("parseAspectApiResponse", () => {
  it("sorts required aspects first", () => {
    const rows = parseAspectApiResponse({
      aspects: [
        {
          localizedAspectName: "Optional",
          aspectConstraint: { aspectRequired: false, aspectMode: "FREE_TEXT" },
        },
        {
          localizedAspectName: "Required",
          aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY" },
          aspectValues: [{ localizedValue: "A" }],
        },
      ],
    });
    expect(rows[0]?.name).toBe("Required");
    expect(rows[0]?.mode).toBe("SELECTION_ONLY");
  });
});

describe("aspect cache fallback", () => {
  afterEach(() => {
    clearCategoryAspectCache();
    clearEbayCategoryTreeIdCache();
    clearEbayTaxonomyCooldown();
    clearEbayCategorySearchCache();
    vi.restoreAllMocks();
  });

  it("returns cached aspects without calling Taxonomy", async () => {
    cacheCategoryAspects("41087", "0", [
      {
        name: "Type",
        required: false,
        mode: "SELECTION_ONLY",
        cardinality: "SINGLE",
        suggestedValues: ["Clock"],
      },
      {
        name: "Brand",
        required: false,
        mode: "SELECTION_ONLY",
        cardinality: "SINGLE",
        suggestedValues: ["Howard Miller"],
      },
    ]);
    vi.spyOn(config, "isEbayConfigured").mockReturnValue(true);
    const ebayGet = vi.spyOn(client, "ebayGet");
    const rows = await getItemAspectsForCategory("41087");
    expect(rows[0]?.name).toBe("Type");
    expect(ebayGet).not.toHaveBeenCalled();
  });

  it("serves stale cached aspects when Taxonomy returns 429", async () => {
    const now = Date.now();
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(now);
    cacheCategoryAspects("41087", "0", [
      {
        name: "Brand",
        required: false,
        mode: "FREE_TEXT",
        cardinality: "SINGLE",
        suggestedValues: [],
      },
    ]);
    dateNow.mockReturnValue(now + 8 * 24 * 60 * 60 * 1000);

    vi.spyOn(config, "isEbayConfigured").mockReturnValue(true);
    vi.spyOn(oauth, "withEbayApplicationTokenRetry").mockImplementation(async (fn) => fn("token"));
    vi.spyOn(client, "ebayGet").mockRejectedValueOnce(
      new EbayApiError(
        "[#2001 · ACCESS · REQUEST · HTTP 429] The request limit has been reached for the resource.",
        429,
        { errors: [{ errorId: 2001, message: "The request limit has been reached for the resource." }] },
        "/taxonomy"
      )
    );

    const rows = await getItemAspectsForCategory("41087");
    expect(rows[0]?.name).toBe("Brand");
  });

  it("serves cached aspects when Taxonomy returns 401", async () => {
    cacheCategoryAspects("41087", "0", [
      {
        name: "Professional grader",
        required: true,
        mode: "SELECTION_ONLY",
        cardinality: "SINGLE",
        suggestedValues: ["PCGS"],
      },
    ]);

    vi.spyOn(config, "isEbayConfigured").mockReturnValue(true);
    vi.spyOn(oauth, "withEbayApplicationTokenRetry").mockImplementation(async (fn) =>
      fn("token")
    );
    vi.spyOn(client, "ebayGet")
      .mockResolvedValueOnce({ categoryTreeId: "0" })
      .mockRejectedValueOnce(new EbayApiError("unauthorized", 401, null, "/taxonomy"));

    const rows = await getItemAspectsForCategory("41087");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Professional grader");
  });

  it("returns null from getCachedCategoryAspects when empty", () => {
    expect(getCachedCategoryAspects("41087", "0")).toBeNull();
  });

  it("loads official Type values from Metadata with the application token", async () => {
    vi.spyOn(config, "isEbayConfigured").mockReturnValue(true);
    vi.spyOn(oauth, "withEbayApplicationTokenRetry").mockImplementation(async (fn) => fn("app-token"));
    const ebayGet = vi.spyOn(client, "ebayGet").mockResolvedValueOnce({
      aspects: [
        {
          localizedAspectName: "Type",
          aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY" },
          aspectValues: [{ localizedValue: "Wall Clock" }, { localizedValue: "Desk Clock" }],
        },
        {
          localizedAspectName: "Brand",
          aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY" },
          aspectValues: [{ localizedValue: "Howard Miller" }, { localizedValue: "Seiko" }],
        },
      ],
    });

    const rows = await getItemAspectsForCategory("261605");
    expect(rows.find((row) => row.name === "Type")?.suggestedValues).toEqual(["Wall Clock", "Desk Clock"]);
    expect(rows.find((row) => row.name === "Brand")?.suggestedValues).toEqual(["Howard Miller", "Seiko"]);
    expect(ebayGet.mock.calls[0]?.[0]).toBe("app-token");
    expect(String(ebayGet.mock.calls[0]?.[1])).toMatch(/sell\/metadata/);
    expect(ebayGet).toHaveBeenCalledTimes(1);
  });

  it("does not ask Taxonomy when Metadata already returned aspects", async () => {
    vi.spyOn(config, "isEbayConfigured").mockReturnValue(true);
    vi.spyOn(oauth, "withEbayApplicationTokenRetry").mockImplementation(async (fn) => fn("token"));
    const ebayGet = vi.spyOn(client, "ebayGet").mockResolvedValueOnce({
      aspects: [
        {
          localizedAspectName: "Type",
          aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY" },
          aspectValues: [{ localizedValue: "Wall Clock" }],
        },
      ],
    });

    const rows = await getItemAspectsForCategory("261605");
    expect(rows.find((row) => row.name === "Type")?.suggestedValues).toEqual(["Wall Clock"]);
    expect(ebayGet).toHaveBeenCalledTimes(1);
    expect(String(ebayGet.mock.calls[0]?.[1])).toMatch(/sell\/metadata/);
  });
});

describe("searchEbayCategories", () => {
  afterEach(() => {
    clearEbayTaxonomyCooldown();
    clearEbayCategorySearchCache();
    clearEbayCategoryTreeIdCache();
    vi.restoreAllMocks();
  });

  it("serves a cached search when Taxonomy is rate-limited", async () => {
    cacheEbayCategorySearch("clock", [
      { categoryId: "261605", categoryName: "Clocks", categoryPath: "Collectibles > Clocks" },
    ]);
    vi.spyOn(config, "isEbayConfigured").mockReturnValue(true);
    vi.spyOn(oauth, "withEbayApplicationTokenRetry").mockImplementation(async (fn) => fn("token"));
    const ebayGet = vi.spyOn(client, "ebayGet").mockRejectedValueOnce(
      new EbayApiError(
        "[#2001 · ACCESS · REQUEST · HTTP 429] The request limit has been reached for the resource.",
        429,
        { errors: [{ errorId: 2001, message: "The request limit has been reached for the resource." }] },
        "/taxonomy"
      )
    );

    await expect(searchEbayCategories("clock")).resolves.toEqual([
      { categoryId: "261605", categoryName: "Clocks", categoryPath: "Collectibles > Clocks" },
    ]);
    expect(ebayGet).toHaveBeenCalledTimes(1);
  });

  it("does not call Taxonomy for a cached search while cooling down after a 429", async () => {
    cacheEbayCategorySearch("clock", [{ categoryId: "1", categoryName: "Clocks" }]);
    markEbayTaxonomyRateLimited();
    vi.spyOn(config, "isEbayConfigured").mockReturnValue(true);
    const ebayGet = vi.spyOn(client, "ebayGet");

    await expect(searchEbayCategories("clock")).resolves.toEqual([{ categoryId: "1", categoryName: "Clocks" }]);
    expect(ebayGet).not.toHaveBeenCalled();
  });

  it("still asks eBay for a new category search while cooling down", async () => {
    markEbayTaxonomyRateLimited();
    vi.spyOn(config, "isEbayConfigured").mockReturnValue(true);
    vi.spyOn(oauth, "withEbayApplicationTokenRetry").mockImplementation(async (fn) => fn("token"));
    const ebayGet = vi.spyOn(client, "ebayGet").mockResolvedValueOnce({
      categorySuggestions: [{ category: { categoryId: "39477", categoryName: "Coins" } }],
    });

    await expect(searchEbayCategories("coin")).resolves.toEqual([
      { categoryId: "39477", categoryName: "Coins", categoryPath: "Coins" },
    ]);
    expect(ebayGet).toHaveBeenCalledTimes(1);
  });
});

describe("getDefaultCategoryTreeId", () => {
  afterEach(() => {
    clearEbayCategoryTreeIdCache();
    vi.restoreAllMocks();
  });

  it("returns the US tree id without a live Taxonomy lookup", async () => {
    const ebayGet = vi.spyOn(client, "ebayGet");
    await expect(getDefaultCategoryTreeId()).resolves.toBe("0");
    expect(ebayGet).not.toHaveBeenCalled();
  });
});
