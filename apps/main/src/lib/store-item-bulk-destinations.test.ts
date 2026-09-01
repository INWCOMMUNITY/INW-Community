import { describe, expect, it } from "vitest";
import {
  BULK_DESTINATION_COPY,
  MANAGE_LISTINGS_UNCHECK_NOTE,
  assignmentsFromGrid,
  columnChecked,
  hasUnsyncInw,
  initialGridRows,
  isProviderCellEnabled,
  planBulkDestinations,
  setGridColumn,
  summarizeBulkDestinations,
  type BulkDestinationGridItem,
  type ItemLinkState,
} from "./store-item-bulk-destinations";

function item(overrides: Partial<BulkDestinationGridItem> = {}): BulkDestinationGridItem {
  return {
    id: "a",
    title: "Coin lot",
    photos: [],
    status: "active",
    channelLinks: [{ provider: "ebay" }, { provider: "wix" }],
    ...overrides,
  };
}

const columns = ["ebay", "etsy", "wix"] as const;

describe("initialGridRows", () => {
  it("pre-checks INW and currently linked stores", () => {
    const rows = initialGridRows("sync", [item()], [...columns]);
    expect(rows[0]).toEqual({
      storeItemId: "a",
      inw: true,
      providers: { ebay: true, etsy: false, wix: true },
    });
  });
});

describe("isProviderCellEnabled", () => {
  it("allows any store on Manage Listings", () => {
    expect(isProviderCellEnabled("sync", item({ channelLinks: [] }), "etsy")).toBe(true);
  });

  it("only allows live stores on End and Delete", () => {
    const listed = item();
    expect(isProviderCellEnabled("end", listed, "ebay")).toBe(true);
    expect(isProviderCellEnabled("end", listed, "etsy")).toBe(false);
    expect(isProviderCellEnabled("delete", listed, "wix")).toBe(true);
    expect(isProviderCellEnabled("delete", listed, "etsy")).toBe(false);
  });
});

describe("setGridColumn", () => {
  it("toggles INW for every row", () => {
    const items = [item(), item({ id: "b", channelLinks: [] })];
    const rows = initialGridRows("sync", items, [...columns]);
    const next = setGridColumn(rows, items, "inw", false, "sync");
    expect(next.every((r) => r.inw === false)).toBe(true);
    expect(hasUnsyncInw("sync", next)).toBe(true);
  });

  it("does not check disabled End/Delete cells", () => {
    const items = [item()];
    const rows = initialGridRows("end", items, [...columns]);
    const next = setGridColumn(rows, items, "etsy", true, "end");
    expect(next[0].providers.etsy).toBe(false);
    expect(columnChecked(next, items, "ebay", "end")).toBe(true);
  });
});

describe("planBulkDestinations", () => {
  const listed: ItemLinkState = {
    id: "a",
    status: "active",
    linkedProviders: ["ebay", "wix"],
  };

  it("diffs list vs unsync vs spare-a-store on Manage Listings", () => {
    const plan = planBulkDestinations("sync", [listed], [
      { storeItemId: "a", inw: true, providers: ["wix", "etsy"] },
    ]);
    expect(plan.publish).toEqual([{ itemId: "a", providers: ["etsy"] }]);
    expect(plan.unpublish).toEqual([{ itemId: "a", providers: ["ebay"] }]);
    expect(plan.unsyncInw).toEqual([]);
    expect(plan.endInw).toEqual([]);
  });

  it("unsyncs INW without unpublishing stores that stay checked", () => {
    const plan = planBulkDestinations("sync", [listed], [
      { storeItemId: "a", inw: false, providers: ["ebay", "wix"] },
    ]);
    expect(plan.publish).toEqual([]);
    expect(plan.unpublish).toEqual([]);
    expect(plan.unsyncInw).toEqual(["a"]);
  });

  it("ends INW and unpublishes checked live shops", () => {
    const plan = planBulkDestinations("end", [listed], [
      { storeItemId: "a", inw: true, providers: ["ebay", "wix"] },
    ]);
    expect(plan.unpublish).toEqual([{ itemId: "a", providers: ["ebay", "wix"] }]);
    expect(plan.endInw).toEqual(["a"]);
  });

  it("ends INW only when End leaves channels unchecked", () => {
    const plan = planBulkDestinations("end", [listed], [
      { storeItemId: "a", inw: true, providers: [] },
    ]);
    expect(plan.unpublish).toEqual([]);
    expect(plan.endInw).toEqual(["a"]);
    expect(plan.deleteInw).toEqual([]);
  });

  it("ends selected channels only when INW is unchecked", () => {
    const plan = planBulkDestinations("end", [listed], [
      { storeItemId: "a", inw: false, providers: ["ebay"] },
    ]);
    expect(plan.unpublish).toEqual([{ itemId: "a", providers: ["ebay"] }]);
    expect(plan.endInw).toEqual([]);
  });

  it("deletes INW after selected channel deletes, sparing unchecked stores", () => {
    const plan = planBulkDestinations("delete", [listed], [
      { storeItemId: "a", inw: true, providers: ["ebay"] },
    ]);
    expect(plan.unpublish).toEqual([{ itemId: "a", providers: ["ebay"] }]);
    expect(plan.deleteInw).toEqual(["a"]);
  });
});

describe("Manage Listings copy", () => {
  it("warns that unchecking a store deletes the third-party listing", () => {
    expect(MANAGE_LISTINGS_UNCHECK_NOTE).toMatch(/deletes that listing/i);
    expect(BULK_DESTINATION_COPY.sync.body).toMatch(/delete that listing/i);
  });

  it("summarizes unpublished stores as deleted, not merely removed", () => {
    const summary = summarizeBulkDestinations("sync", {
      published: 0,
      unpublished: 1,
      ended: 0,
      deleted: 0,
      unsyncedInw: 1,
      failed: 0,
      skipped: 0,
    });
    expect(summary.title).toBe("Taken Down");
    expect(summary.message).toMatch(/Deleted 1 listing from a connected store/);
    expect(summary.message).toMatch(/gone there — not just unsynced/);
    expect(summary.message).toMatch(/quantity tracking is off/);
    expect(summary.message).not.toMatch(/Removed from stores/);
    expect(summary.message).not.toMatch(/Stopped INW quantity tracking/);
  });

  it("celebrates a clean list-on-store", () => {
    const summary = summarizeBulkDestinations("sync", {
      published: 2,
      unpublished: 0,
      ended: 0,
      deleted: 0,
      unsyncedInw: 0,
      failed: 0,
      skipped: 0,
    });
    expect(summary.title).toBe("You're Live");
    expect(summary.message).toMatch(/They're live/);
  });

  it("says when a change failed instead of a bland Failed count", () => {
    const summary = summarizeBulkDestinations("sync", {
      published: 0,
      unpublished: 0,
      ended: 0,
      deleted: 0,
      unsyncedInw: 0,
      failed: 1,
      skipped: 0,
      results: [{ status: "failed", detail: "eBay: Missing Brand" }],
    });
    expect(summary.ok).toBe(false);
    expect(summary.title).toBe("Couldn't Finish That");
    expect(summary.message).toMatch(/didn't go through/);
    expect(summary.message).toContain("eBay: Missing Brand");
  });
});

describe("assignmentsFromGrid", () => {
  it("omits unchecked stores", () => {
    const rows = initialGridRows("sync", [item()], [...columns]);
    rows[0].providers.etsy = true;
    rows[0].providers.ebay = false;
    expect(assignmentsFromGrid(rows)[0].providers.sort()).toEqual(["etsy", "wix"]);
  });
});
