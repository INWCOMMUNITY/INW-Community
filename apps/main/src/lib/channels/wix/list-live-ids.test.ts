import { describe, expect, it } from "vitest";
import { shouldUseWixCatalogResult, wixLinkMissingFromLiveCatalog } from "./list-live-ids";

describe("wixLinkMissingFromLiveCatalog", () => {
  it("treats a linked id that is not on the live Wix catalog as gone", () => {
    expect(wixLinkMissingFromLiveCatalog("prod-1", new Set(["prod-2"]))).toBe(true);
    expect(wixLinkMissingFromLiveCatalog("prod-1", new Set(["prod-1"]))).toBe(false);
  });
});

describe("shouldUseWixCatalogResult", () => {
  it("treats a finished empty catalog as the real shop, not a reason to try another API", () => {
    expect(shouldUseWixCatalogResult({ ids: [], truncated: false })).toBe(true);
  });

  it("uses a finished catalog that still has products", () => {
    expect(shouldUseWixCatalogResult({ ids: ["p1"], truncated: false })).toBe(true);
  });

  it("uses a truncated page only when it already has ids", () => {
    expect(shouldUseWixCatalogResult({ ids: ["p1"], truncated: true })).toBe(true);
    expect(shouldUseWixCatalogResult({ ids: [], truncated: true })).toBe(false);
  });
});
