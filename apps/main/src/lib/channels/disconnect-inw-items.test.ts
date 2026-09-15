import { describe, expect, it } from "vitest";
import {
  countLinkedOverlap,
  disconnectSuccessMessage,
  exclusiveAndSharedIds,
  overlapCounts,
  parseDeleteInwMode,
  shouldDropRetryForDisconnectedConnection,
  shouldSkipChannelSync,
  storeItemIdsToDelete,
} from "./disconnect-inw-items";

describe("shouldSkipChannelSync", () => {
  it("skips disconnected and revoked for every provider", () => {
    expect(shouldSkipChannelSync("disconnected", "ebay")).toBe(true);
    expect(shouldSkipChannelSync("revoked", "etsy")).toBe(true);
    expect(shouldSkipChannelSync("active", "ebay")).toBe(false);
    expect(shouldSkipChannelSync("error", "ebay")).toBe(false);
  });

  it("freezes Shopify unless the connection is active", () => {
    expect(shouldSkipChannelSync("active", "shopify")).toBe(false);
    expect(shouldSkipChannelSync("error", "shopify")).toBe(true);
    expect(shouldSkipChannelSync("disconnected", "shopify")).toBe(true);
    expect(shouldSkipChannelSync(undefined, "shopify")).toBe(true);
  });
});

describe("shouldDropRetryForDisconnectedConnection", () => {
  it("drops retries after the seller disconnects or the token is revoked", () => {
    expect(shouldDropRetryForDisconnectedConnection("disconnected")).toBe(true);
    expect(shouldDropRetryForDisconnectedConnection("revoked")).toBe(true);
    expect(shouldDropRetryForDisconnectedConnection("active")).toBe(false);
    expect(shouldDropRetryForDisconnectedConnection("error")).toBe(false);
    expect(shouldDropRetryForDisconnectedConnection(undefined)).toBe(false);
  });

  it("drops Shopify retries while the store is paused", () => {
    expect(shouldDropRetryForDisconnectedConnection("error", "shopify")).toBe(true);
    expect(shouldDropRetryForDisconnectedConnection("active", "shopify")).toBe(false);
    expect(shouldDropRetryForDisconnectedConnection("error", "ebay")).toBe(false);
  });
});

describe("parseDeleteInwMode", () => {
  it("keeps all INW items unless a delete flag is set", () => {
    expect(parseDeleteInwMode(null)).toBe("none");
    expect(parseDeleteInwMode("0")).toBe("none");
  });

  it("treats legacy deleteInwItems=1 as delete all", () => {
    expect(parseDeleteInwMode("1")).toBe("all");
    expect(parseDeleteInwMode("true")).toBe("all");
    expect(parseDeleteInwMode("all")).toBe("all");
  });

  it("supports deleting only listings that are not on other stores", () => {
    expect(parseDeleteInwMode("exclusive")).toBe("exclusive");
    expect(parseDeleteInwMode("keepShared")).toBe("exclusive");
  });
});

describe("countLinkedOverlap", () => {
  const etsy = "etsy-conn";
  const ebay = "ebay-conn";

  it("counts listings also linked to another live store", () => {
    const overlap = countLinkedOverlap(etsy, [
      { connectionId: etsy, storeItemId: "shared", connectionStatus: "active" },
      { connectionId: ebay, storeItemId: "shared", connectionStatus: "active" },
      { connectionId: etsy, storeItemId: "only-etsy", connectionStatus: "active" },
    ]);
    expect(overlap).toEqual({ linkedOnlyThisChannel: 1, linkedAlsoOnOthers: 1 });
  });

  it("ignores links on a disconnected store", () => {
    const overlap = countLinkedOverlap(etsy, [
      { connectionId: etsy, storeItemId: "a", connectionStatus: "active" },
      { connectionId: ebay, storeItemId: "a", connectionStatus: "disconnected" },
    ]);
    expect(overlap).toEqual({ linkedOnlyThisChannel: 1, linkedAlsoOnOthers: 0 });
  });

  it("treats an error/paused store as still connected", () => {
    const overlap = countLinkedOverlap(etsy, [
      { connectionId: etsy, storeItemId: "a", connectionStatus: "active" },
      { connectionId: ebay, storeItemId: "a", connectionStatus: "error" },
    ]);
    expect(overlap).toEqual({ linkedOnlyThisChannel: 0, linkedAlsoOnOthers: 1 });
  });
});

describe("storeItemIdsToDelete", () => {
  it("deletes nothing when keeping all on INW", () => {
    expect(storeItemIdsToDelete("none", ["a"], ["a", "b"])).toEqual([]);
  });

  it("deletes only exclusive items in exclusive mode", () => {
    expect(storeItemIdsToDelete("exclusive", ["a"], ["a", "b"])).toEqual(["a"]);
  });

  it("deletes every linked item in all mode", () => {
    expect(storeItemIdsToDelete("all", ["a"], ["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("exclusiveAndSharedIds", () => {
  it("splits by other live item ids", () => {
    expect(exclusiveAndSharedIds(["a", "b"], new Set(["b"]))).toEqual({
      exclusiveIds: ["a"],
      sharedIds: ["b"],
    });
  });
});

describe("overlapCounts", () => {
  it("falls back to linkedListings when overlap fields are missing", () => {
    expect(overlapCounts({ linkedListings: 5 })).toEqual({
      linked: 5,
      onlyThis: 5,
      alsoOthers: 0,
    });
  });

  it("uses API overlap fields when present", () => {
    expect(
      overlapCounts({ linkedListings: 5, linkedOnlyThisChannel: 2, linkedAlsoOnOthers: 3 })
    ).toEqual({ linked: 5, onlyThis: 2, alsoOthers: 3 });
  });
});

describe("disconnectSuccessMessage", () => {
  it("explains exclusive vs all deletes", () => {
    expect(disconnectSuccessMessage("Etsy", "none", {})).toMatch(/unchanged/i);
    expect(
      disconnectSuccessMessage("Etsy", "exclusive", { deletedInwCount: 2, keptInwCount: 3 })
    ).toMatch(/only on Etsy/);
    expect(disconnectSuccessMessage("Etsy", "all", { deletedInwCount: 5 })).toMatch(
      /removed from INW/
    );
  });
});
