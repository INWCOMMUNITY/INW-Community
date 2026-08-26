import { describe, expect, it } from "vitest";
import {
  classifyListingNeedsAttention,
  classifyShopNeedsAttention,
  isEtsyOriginSyncError,
  isEtsyPostalSyncError,
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
