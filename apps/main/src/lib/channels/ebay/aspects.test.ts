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

  it("falls back to US tree id 0 when get_default_category_tree_id 404s", async () => {
    vi.spyOn(oauth, "withEbayApplicationTokenRetry").mockImplementation(async (fn) => fn("token"));
    vi.spyOn(client, "ebayGet").mockRejectedValueOnce(
      new EbayApiError("not found", 404, null, "/get_default_category_tree_id")
    );
    await expect(getDefaultCategoryTreeId()).resolves.toBe("0");
  });
});
