import { describe, expect, it } from "vitest";
import { wixLinkMissingFromLiveCatalog } from "./list-live-ids";

describe("wixLinkMissingFromLiveCatalog", () => {
  it("treats a linked id that is not on the live Wix catalog as gone", () => {
    expect(wixLinkMissingFromLiveCatalog("prod-1", new Set(["prod-2"]))).toBe(true);
    expect(wixLinkMissingFromLiveCatalog("prod-1", new Set(["prod-1"]))).toBe(false);
  });
});
