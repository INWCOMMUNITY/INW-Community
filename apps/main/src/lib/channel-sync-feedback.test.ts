import { describe, it, expect } from "vitest";
import { buildPublishResultAlert, buildSyncFailureMessage, isChannelPublishOk } from "./channel-sync-feedback";

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

  it("keeps the full eBay #25014 pictures message", () => {
    const alert = buildPublishResultAlert([
      {
        provider: "ebay",
        ok: false,
        error:
          "title: failed ([#25014 · API_INVENTORY · Request · HTTP 400] The eBay listing associated with the inventory item, or the unpublished offer has invalid pictures.) — eBay rejected the listing photos. Re-upload at least one HTTPS JPG or PNG on this item, then try again.",
      },
    ]);
    expect(alert.message).toContain("unpublished offer has invalid pictures");
    expect(alert.message).toContain("Re-upload");
  });

  it("treats an empty or failed channelSync as not listed", () => {
    expect(isChannelPublishOk([])).toBe(false);
    expect(isChannelPublishOk(undefined)).toBe(false);
    expect(isChannelPublishOk([{ provider: "ebay", ok: false, error: "Missing Brand" }])).toBe(
      false
    );
    expect(isChannelPublishOk([{ provider: "ebay", ok: true }])).toBe(true);
  });
});

describe("buildSyncFailureMessage", () => {
  it("does not say the listing was removed when marketplace delete failed", () => {
    const msg = buildSyncFailureMessage(
      "not removed from the selected marketplace",
      ["Etsy: listing is still active"],
      "removed"
    );
    expect(msg).toMatch(/could not remove/i);
    expect(msg).toMatch(/still linked/i);
    expect(msg).toContain("Etsy");
  });
});
