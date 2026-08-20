import { describe, it, expect } from "vitest";
import { buildPublishResultAlert } from "./channel-sync-feedback";

describe("buildPublishResultAlert", () => {
  it("explains an empty result instead of staying silent", () => {
    const alert = buildPublishResultAlert([]);
    expect(alert.title).toBe("Could not list");
    expect(alert.message).toMatch(/check sync stores/i);
  });

  it("reports a live listing", () => {
    const alert = buildPublishResultAlert([{ provider: "wix", ok: true }]);
    expect(alert.title).toBe("Listed");
    expect(alert.message).toBe("Listed on Wix.");
  });

  it("reports a failed listing with the provider error", () => {
    const alert = buildPublishResultAlert([
      { provider: "ebay", ok: false, error: "Missing required eBay item specifics: Brand" },
    ]);
    expect(alert.title).toBe("Could not list");
    expect(alert.message).toContain("eBay");
    expect(alert.message).toContain("Brand");
  });
});
