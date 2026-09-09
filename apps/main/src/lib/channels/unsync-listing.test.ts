import { describe, expect, it } from "vitest";
import { importedChannelLinkWhere, unsyncedInwLinkShouldBeForgotten } from "./unsync-listing";

describe("importedChannelLinkWhere", () => {
  it("only counts still-synced INW imports", () => {
    expect(importedChannelLinkWhere("conn-1", "ebay")).toEqual({
      provider: "ebay",
      connectionId: "conn-1",
      syncEnabled: true,
    });
  });
});

describe("unsyncedInwLinkShouldBeForgotten", () => {
  it("forgets Manage Listings unsync leftovers so Import can recreate the item", () => {
    expect(
      unsyncedInwLinkShouldBeForgotten({ storeItemStatus: "inactive", syncEnabled: false })
    ).toBe(true);
  });

  it("keeps ended listings that are still imported (Relist, not Import)", () => {
    expect(
      unsyncedInwLinkShouldBeForgotten({ storeItemStatus: "inactive", syncEnabled: true })
    ).toBe(false);
  });

  it("keeps live imports", () => {
    expect(
      unsyncedInwLinkShouldBeForgotten({ storeItemStatus: "active", syncEnabled: true })
    ).toBe(false);
  });
});
