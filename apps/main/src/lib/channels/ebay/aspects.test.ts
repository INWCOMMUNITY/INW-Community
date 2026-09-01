import { afterEach, describe, expect, it, vi } from "vitest";
import { EbayApiError } from "./errors";
import {
  cacheCategoryAspects,
  clearCategoryAspectCache,
  clearEbayCategoryTreeIdCache,
  getCachedCategoryAspects,
  getDefaultCategoryTreeId,
  getItemAspectsForCategory,
  parseAspectApiResponse,
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
