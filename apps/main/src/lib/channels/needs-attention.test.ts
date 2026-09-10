import { describe, expect, it } from "vitest";
import {
  attentionFingerprint,
  classifyListingNeedsAttention,
  classifyShopNeedsAttention,
  ebayAttentionFieldsFromCategoryAspects,
  ebayAttentionSpecificNames,
  isAttentionDismissed,
  isEtsyOriginSyncError,
  isEtsyPostalSyncError,
  withAttentionDismissed,
  transientSyncErrorSuppressed,
  TRANSIENT_ATTENTION_GRACE_MS,
  etsyProactiveFieldCardApplies,
  isEbayListingEndedNotice,
  isZeroPushSkippedNotice,
  dismissShouldClearSyncError,
} from "./needs-attention";

const item = {
  title: "Shadow Gate NES",
  photos: ["https://example.com/a.jpg"],
  etsyWhoMade: "i_did" as string | null,
  etsyWhenMade: "1980s" as string | null,
  etsyIsSupply: false as boolean | null,
  etsyTaxonomyId: 891 as number | null,
  condition: "used" as string | null,
};

describe("classifyListingNeedsAttention", () => {
  it("asks for origin fields when Etsy rejects a partial who_made PATCH", () => {
    const result = classifyListingNeedsAttention({
      provider: "etsy",
      syncError:
        "Cannot update 'when_made' without 'who_made' and  without 'is_supply' and vice versa",
      item,
    });
    expect(result?.action).toBe("fill");
    expect(result?.fields.map((f) => f.key)).toEqual([
      "etsyWhoMade",
      "etsyWhenMade",
      "etsyIsSupply",
    ]);
  });

  it("asks for who/when when they are missing even without a sync error", () => {
    const result = classifyListingNeedsAttention({
      provider: "etsy",
      syncError: null,
      item: { ...item, etsyWhoMade: null, etsyWhenMade: null },
    });
    expect(result?.fields.some((f) => f.key === "etsyWhoMade")).toBe(true);
    expect(result?.fields.some((f) => f.key === "etsyWhenMade")).toBe(true);
  });

  it("asks for an Etsy category when taxonomy is missing", () => {
    const result = classifyListingNeedsAttention({
      provider: "etsy",
      syncError: null,
      item: { ...item, etsyTaxonomyId: null },
    });
    expect(result?.fields.some((f) => f.key === "etsyTaxonomyId")).toBe(true);
  });

  it("marks eBay condition errors as a dedicated action", () => {
    const result = classifyListingNeedsAttention({
      provider: "ebay",
      syncError: "Invalid item condition (Error 25021)",
      item,
    });
    expect(result?.action).toBe("ebay_condition");
  });

  it("keeps unknown Etsy errors as retry-only", () => {
    const result = classifyListingNeedsAttention({
      provider: "etsy",
      syncError: "503 Service Unavailable",
      item,
    });
    expect(result?.action).toBe("retry_only");
    expect(result?.fields).toEqual([]);
  });

  it("asks for a different Etsy category when the marketplace rejects the item", () => {
    const result = classifyListingNeedsAttention({
      provider: "etsy",
      syncError: "marketplace: Oh dear, you cannot sell this item on Etsy.",
      item,
    });
    expect(result?.action).toBe("fill");
    expect(result?.fields.some((f) => f.key === "etsyTaxonomyId")).toBe(true);
    expect(result?.summary).toMatch(/will not sell this item/i);
  });

  it("asks for missing eBay Type/Brand item specifics", () => {
    const result = classifyListingNeedsAttention({
      provider: "ebay",
      syncError:
        "The item specific Type is missing. Add Type to this listing, enter a valid value, and then try again.",
      item,
    });
    expect(result?.action).toBe("fill");
    expect(result?.fields.map((f) => f.key)).toEqual(["aspect:Type"]);
  });

  it("asks for Type and Brand from the listed-specifics error", () => {
    const result = classifyListingNeedsAttention({
      provider: "ebay",
      syncError:
        "Listing details didn't update on eBay: Missing required eBay item specifics: Type, Brand. Fill them in under eBay Listing Requirements.",
      item,
    });
    expect(result?.action).toBe("fill");
    expect(result?.fields.map((f) => f.key)).toEqual(["aspect:Type", "aspect:Brand"]);
    expect(result?.summary).toMatch(/Type and Brand/i);
  });

  it("asks for Type and Brand when category specifics could not load", () => {
    const result = classifyListingNeedsAttention({
      provider: "ebay",
      syncError:
        "Listing details didn't update on eBay: Missing required eBay item specifics: eBay category taxonomy (could not load required item specifics for this category).",
      item,
    });
    expect(result?.action).toBe("fill");
    expect(result?.fields.map((f) => f.key)).toEqual(["aspect:Type", "aspect:Brand"]);
    expect(result?.fields.some((f) => /taxonomy/i.test(f.label))).toBe(false);
    expect(result?.summary).toMatch(/Type and Brand/i);
  });

  it("never treats the taxonomy-load sentence as an item specific name", () => {
    expect(
      ebayAttentionSpecificNames(
        "Missing required eBay item specifics: eBay category taxonomy (could not load required item specifics for this category)"
      )
    ).toEqual(["Type", "Brand"]);
  });

  it("turns eBay Type values into a clickable dropdown", () => {
    const fields = ebayAttentionFieldsFromCategoryAspects({
      categoryAspects: [
        {
          name: "Type",
          required: false,
          mode: "SELECTION_ONLY",
          cardinality: "SINGLE",
          suggestedValues: ["Wall Clock", "Desk Clock"],
        },
        {
          name: "Brand",
          required: false,
          mode: "SELECTION_ONLY",
          cardinality: "SINGLE",
          suggestedValues: ["Unbranded"],
        },
      ],
      existingAspects: [],
      title: "Vintage Bear Clock",
      fallbackNames: ["Type", "Brand"],
    });
    const typeField = fields.find((f) => f.key === "aspect:Type");
    expect(typeField?.type).toBe("select");
    expect(typeField?.options?.some((o) => o.value === "Wall Clock")).toBe(true);
  });

  it("keeps eBay photo-host mix errors in Needs Attention as retry-only", () => {
    const result = classifyListingNeedsAttention({
      provider: "ebay",
      syncError:
        "[#25014 · API_INVENTORY · Request · HTTP 400] A mixture of Self Hosted and EPS pictures are not allowed.",
      item,
    });
    expect(result?.action).toBe("retry_only");
    expect(result?.summary).toMatch(/25014|mixture/i);
  });

  it("explains eBay variation SKU collisions as retry-only", () => {
    const result = classifyListingNeedsAttention({
      provider: "ebay",
      syncError:
        "Listing details didn't update on eBay: [#25002] Required variationInformation container is missing.",
      item,
    });
    expect(result?.action).toBe("retry_only");
    expect(result?.summary).toMatch(/variation listing/i);
    expect(result?.summary).toMatch(/generated SKUs/i);
  });
});

describe("classifyShopNeedsAttention", () => {
  it("asks for a ship-from ZIP when Etsy listings already need attention", () => {
    const result = classifyShopNeedsAttention({
      provider: "etsy",
      originPostalCode: null,
      lastError: null,
      listingPostalError: false,
      hasEtsyListingAttention: true,
    });
    expect(result?.fields[0]?.key).toBe("etsyOriginPostalCode");
  });

  it("does not ask for ZIP when one is already saved", () => {
    expect(
      classifyShopNeedsAttention({
        provider: "etsy",
        originPostalCode: "99201",
        lastError: "Postal Code is required",
        listingPostalError: true,
        hasEtsyListingAttention: false,
      })
    ).toBeNull();
  });
});

describe("error matchers", () => {
  it("detects Etsy origin and postal failures", () => {
    expect(isEtsyOriginSyncError("Cannot update 'when_made' without 'who_made'")).toBe(true);
    expect(isEtsyPostalSyncError("Postal Code is required. min/max delivery days")).toBe(true);
  });
});

describe("attention dismissal", () => {
  it("hides the same request and shows a new error again", () => {
    const first = attentionFingerprint({
      action: "fill",
      fields: [{ key: "aspect:Type" }, { key: "aspect:Brand" }],
      summary: "eBay needs Type and Brand for this category. Pick the values eBay lists.",
      syncError: "Missing required eBay item specifics: Type, Brand.",
    });
    const stored = withAttentionDismissed({}, first);
    expect(isAttentionDismissed(stored, first)).toBe(true);
    const later = attentionFingerprint({
      action: "fill",
      fields: [{ key: "aspect:Material" }],
      summary: "eBay needs Material before this listing can go live.",
      syncError: "Missing required eBay item specifics: Material.",
    });
    expect(isAttentionDismissed(stored, later)).toBe(false);
  });
});

describe("transientSyncErrorSuppressed", () => {
  const now = new Date("2026-09-09T18:00:00.000Z");
  const fresh = new Date(now.getTime() - 60_000);

  it("hides a 429/rate-limit error while an auto-retry is still in flight", () => {
    expect(
      transientSyncErrorSuppressed({
        syncError: "429 Too Many Requests: calls per second exceeded",
        retries: [{ attempts: 1, maxAttempts: 5, createdAt: fresh }],
        now,
      })
    ).toBe(true);
  });

  it("hides a 503 while retrying", () => {
    expect(
      transientSyncErrorSuppressed({
        syncError: "503 Service Unavailable",
        retries: [{ attempts: 2, maxAttempts: 5, createdAt: fresh }],
        now,
      })
    ).toBe(true);
  });

  it("surfaces once the auto-retries are exhausted", () => {
    expect(
      transientSyncErrorSuppressed({
        syncError: "503 Service Unavailable",
        retries: [{ attempts: 5, maxAttempts: 5, createdAt: fresh }],
        now,
      })
    ).toBe(false);
  });

  it("surfaces a transient error that has been stuck past the grace window", () => {
    const stale = new Date(now.getTime() - TRANSIENT_ATTENTION_GRACE_MS - 60_000);
    expect(
      transientSyncErrorSuppressed({
        syncError: "timeout",
        retries: [{ attempts: 1, maxAttempts: 5, createdAt: stale }],
        now,
      })
    ).toBe(false);
  });

  it("surfaces when there is no retry scheduled (nothing will auto-heal it)", () => {
    expect(
      transientSyncErrorSuppressed({
        syncError: "429 Too Many Requests",
        retries: [],
        now,
      })
    ).toBe(false);
  });

  it("never suppresses a permanent/actionable error, even mid-retry", () => {
    expect(
      transientSyncErrorSuppressed({
        syncError: "404 Not Found: invalid listing",
        retries: [{ attempts: 0, maxAttempts: 5, createdAt: fresh }],
        now,
      })
    ).toBe(false);
  });

  it("no-op when there is no error string", () => {
    expect(transientSyncErrorSuppressed({ syncError: null, retries: [], now })).toBe(false);
  });
});

describe("etsyProactiveFieldCardApplies", () => {
  it("nags an ACTIVE listing missing who_made", () => {
    expect(
      etsyProactiveFieldCardApplies({
        status: "active",
        etsyWhoMade: null,
        etsyWhenMade: "1980s",
        etsyTaxonomyId: 891,
      })
    ).toBe(true);
  });

  it("nags an active listing missing a taxonomy id", () => {
    expect(
      etsyProactiveFieldCardApplies({
        status: "active",
        etsyWhoMade: "i_did",
        etsyWhenMade: "1980s",
        etsyTaxonomyId: null,
      })
    ).toBe(true);
  });

  it("does NOT nag a draft/inactive listing that will never publish", () => {
    expect(
      etsyProactiveFieldCardApplies({
        status: "inactive",
        etsyWhoMade: null,
        etsyWhenMade: null,
        etsyTaxonomyId: null,
      })
    ).toBe(false);
  });

  it("does NOT nag a sold-out listing (inventory sync needs no craft fields)", () => {
    expect(
      etsyProactiveFieldCardApplies({
        status: "sold_out",
        etsyWhoMade: null,
        etsyWhenMade: null,
        etsyTaxonomyId: null,
      })
    ).toBe(false);
  });

  it("does NOT nag an active listing that already has every required field", () => {
    expect(
      etsyProactiveFieldCardApplies({
        status: "active",
        etsyWhoMade: "i_did",
        etsyWhenMade: "1980s",
        etsyTaxonomyId: 891,
      })
    ).toBe(false);
  });
});

describe("previously-invisible informational states", () => {
  it("surfaces an eBay-ended listing as a clear, actionable notice", () => {
    expect(isEbayListingEndedNotice("eBay listing ended; inventory will not be revised")).toBe(true);
    const res = classifyListingNeedsAttention({
      provider: "ebay",
      syncError: "eBay listing ended; inventory will not be revised",
      item: { ...item, etsyTaxonomyId: null },
    });
    expect(res?.action).toBe("retry_only");
    expect(res?.summary).toMatch(/ended/i);
    expect(res?.summary).toMatch(/relist/i);
  });

  it("surfaces a zero-push-skipped item so the pill does not lie", () => {
    expect(isZeroPushSkippedNotice("Zero push skipped (syncZeroQuantity disabled)")).toBe(true);
    const res = classifyListingNeedsAttention({
      provider: "shopify",
      syncError: "Zero push skipped (syncZeroQuantity disabled)",
      item,
    });
    expect(res?.action).toBe("retry_only");
    expect(res?.summary).toMatch(/out of stock/i);
  });

  it("does not treat ordinary strings as notices", () => {
    expect(isEbayListingEndedNotice("some other error")).toBe(false);
    expect(isZeroPushSkippedNotice(null)).toBe(false);
  });
});

describe("dismissShouldClearSyncError", () => {
  it("clears the error when the condition already resolved (no card)", () => {
    expect(dismissShouldClearSyncError(null)).toBe(true);
  });

  it("clears for a plain retry-only error or informational notice the seller acknowledged", () => {
    expect(dismissShouldClearSyncError({ action: "retry_only" })).toBe(true);
  });

  it("does NOT clear a structured field error still genuinely blocking sync", () => {
    expect(dismissShouldClearSyncError({ action: "fill" })).toBe(false);
    expect(dismissShouldClearSyncError({ action: "ebay_condition" })).toBe(false);
  });
});
