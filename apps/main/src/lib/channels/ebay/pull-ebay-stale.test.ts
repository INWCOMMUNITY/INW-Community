import { describe, expect, it } from "vitest";
import {
  ebayGetItemIsStaleVersusInw,
  ebayGetItemApplyDecision,
  ebayGetItemEndedDecision,
  isEbayInboundContentChange,
  ebayGetItemDetailsAreUsable,
  readEbayPendingInboundHash,
  shouldApplyEbayInboundVariants,
  withEbayPendingInbound,
} from "./pull-ebay-updates";

describe("isEbayInboundContentChange", () => {
  it("treats ebayCategoryId-only writes as metadata, not inbound content", () => {
    expect(isEbayInboundContentChange({ ebayCategoryId: 36059 })).toBe(false);
    expect(isEbayInboundContentChange({ ebayCategoryId: 36059, category: "Collectibles" })).toBe(
      false
    );
  });

  it("treats title/price/qty writes as inbound content", () => {
    expect(isEbayInboundContentChange({ title: "EBAY CRON TEST 4" })).toBe(true);
    expect(isEbayInboundContentChange({ priceCents: 4400, ebayCategoryId: 36059 })).toBe(true);
    expect(isEbayInboundContentChange({ quantity: 4 })).toBe(true);
  });

  it("maps a GetItem title/photos/description apply to sibling content fan-out", async () => {
    const { inboundContentFanoutKind } = await import("../listing-link-flags");
    expect(
      isEbayInboundContentChange({
        title: "Bear Clock",
        photos: ["https://i.ebayimg.com/a.jpg"],
        description: "<p>clock</p>",
      })
    ).toBe(true);
    expect(inboundContentFanoutKind({ contentChange: true, soldOut: false })).toBe("content");
    expect(inboundContentFanoutKind({ contentChange: true, soldOut: true })).toBe("inventory");
  });
});

describe("ebayGetItemEndedDecision", () => {
  const now = new Date("2026-09-01T18:00:00.000Z");

  it("does not unlink eBay when GetItem still reports stock", () => {
    expect(
      ebayGetItemEndedDecision({
        listingEnded: true,
        quantity: 2,
        inwUpdatedAt: new Date("2026-08-01T00:00:00.000Z"),
        now,
      })
    ).toBe("active");
  });

  it("does not unlink eBay right after an inbound title edit from another shop", () => {
    expect(
      ebayGetItemEndedDecision({
        listingEnded: true,
        quantity: 0,
        inwUpdatedAt: new Date("2026-09-01T17:50:00.000Z"),
        now,
      })
    ).toBe("active");
  });

  it("flags a listing that ended with no stock after the echo window", () => {
    expect(
      ebayGetItemEndedDecision({
        listingEnded: true,
        quantity: 0,
        inwUpdatedAt: new Date("2026-08-01T00:00:00.000Z"),
        now,
      })
    ).toBe("ended");
  });
});

describe("ebayGetItemDetailsAreUsable", () => {
  it("rejects an empty GetItem failure payload", () => {
    expect(
      ebayGetItemDetailsAreUsable({ title: null, priceCents: null, quantity: null })
    ).toBe(false);
  });

  it("accepts a listing that has any of title, price, or qty", () => {
    expect(
      ebayGetItemDetailsAreUsable({ title: "EBAY CRON TEST 4", priceCents: null, quantity: null })
    ).toBe(true);
    expect(
      ebayGetItemDetailsAreUsable({ title: null, priceCents: 4400, quantity: null })
    ).toBe(true);
  });
});

describe("ebayGetItemIsStaleVersusInw", () => {
  const now = new Date("2026-08-20T05:05:50.000Z");
  const refreshedAt = new Date("2026-08-20T05:04:20.000Z");

  it("skips a lagged GetItem with no last-modified right after an INW refresh", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        inwUpdatedAt: refreshedAt,
        ebayLastModified: null,
        now,
      })
    ).toBe(true);
  });

  it("applies GetItem when eBay was revised after the INW refresh", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        inwUpdatedAt: refreshedAt,
        ebayLastModified: new Date("2026-08-20T05:05:00.000Z"),
        now,
      })
    ).toBe(false);
  });

  it("still skips a lagged GetItem 5 minutes later when LastModified is missing", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        inwUpdatedAt: refreshedAt,
        ebayLastModified: null,
        now: new Date("2026-08-20T05:10:00.000Z"),
      })
    ).toBe(true);
  });

  it("never applies GetItem when LastModified is missing, even 15 minutes later", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        inwUpdatedAt: refreshedAt,
        ebayLastModified: null,
        now: new Date("2026-08-20T05:20:00.000Z"),
      })
    ).toBe(true);
  });

  it("never applies a GetItem whose LastModified is older than the last inbound pull", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        inwUpdatedAt: refreshedAt,
        ebayLastModified: new Date("2026-08-20T05:03:00.000Z"),
        now: new Date("2026-08-20T05:25:00.000Z"),
      })
    ).toBe(true);
  });

  it("applies the first GetItem when INW has never pulled or pushed", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: null,
        lastPushedAt: null,
        inwUpdatedAt: null,
        ebayLastModified: null,
        now,
      })
    ).toBe(false);
  });

  it("skips ItemListed LastModified a few seconds after our publish", () => {
    const pushedAt = new Date("2026-08-20T05:06:00.000Z");
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: null,
        lastPushedAt: pushedAt,
        inwUpdatedAt: pushedAt,
        ebayLastModified: new Date("2026-08-20T05:06:12.000Z"),
        now: new Date("2026-08-20T05:06:15.000Z"),
      })
    ).toBe(true);
  });

  it("skips GetItem that is only an echo of our own inventory push", () => {
    const pushedAt = new Date("2026-08-20T05:06:00.000Z");
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        lastPushedAt: pushedAt,
        inwUpdatedAt: refreshedAt,
        ebayLastModified: new Date("2026-08-20T05:06:01.000Z"),
        now: new Date("2026-08-20T05:06:10.000Z"),
      })
    ).toBe(true);
  });

  it("skips an older eBay snapshot after the seller saves on INW", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: new Date("2026-08-20T05:04:20.000Z"),
        lastPushedAt: new Date("2026-08-20T05:06:00.000Z"),
        inwUpdatedAt: new Date("2026-08-20T05:05:59.000Z"),
        ebayLastModified: new Date("2026-08-20T05:04:00.000Z"),
        now: new Date("2026-08-20T05:10:00.000Z"),
      })
    ).toBe(true);
  });

  it("skips a lagged TEST 5 replica after a successful inbound of the live listing", () => {
    const pulledAt = new Date("2026-08-20T05:04:20.000Z");
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: pulledAt,
        lastAppliedRemoteAt: new Date("2026-08-20T05:04:00.000Z"),
        inwUpdatedAt: pulledAt,
        ebayLastModified: new Date("2026-08-20T04:50:00.000Z"),
        now: new Date("2026-08-20T05:20:00.000Z"),
      })
    ).toBe(true);
  });

  it("applies GetItem when LastModified is newer than inbound, push, and INW save", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        lastPushedAt: new Date("2026-08-20T05:06:00.000Z"),
        inwUpdatedAt: new Date("2026-08-20T05:05:59.000Z"),
        ebayLastModified: new Date("2026-08-20T05:07:00.000Z"),
        now: new Date("2026-08-20T05:07:10.000Z"),
      })
    ).toBe(false);
  });

  it("applies an eBay revise whose LastModified is older than a later qty push stamp", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        lastPushedAt: new Date("2026-08-20T05:20:00.000Z"),
        inwUpdatedAt: refreshedAt,
        ebayLastModified: new Date("2026-08-20T05:10:00.000Z"),
        now: new Date("2026-08-20T05:21:00.000Z"),
      })
    ).toBe(false);
  });
});

describe("ebayGetItemApplyDecision", () => {
  const inbound = new Date("2026-08-20T06:50:03.000Z");
  const base = {
    lastInboundAt: inbound,
    lastPushedAt: new Date("2026-08-20T06:29:13.000Z"),
    inwUpdatedAt: inbound,
    ebayLastModified: null as Date | null,
    inwTitle: "Tachometer EBAY CRON TEST 5",
    inwPriceCents: 4000,
    inwQuantity: 4,
    remoteTitle: "Tachometer EBAY CRON TEST 5",
    remotePriceCents: 4000,
    remoteQuantity: 4,
    pendingRemoteHash: null as string | null,
  };

  it("applies the first pull when LastModified is missing", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastInboundAt: null,
        lastPushedAt: null,
        inwUpdatedAt: null,
      }).action
    ).toBe("apply");
  });

  it("skips when GetItem title/price/qty already match INW", () => {
    expect(ebayGetItemApplyDecision(base)).toEqual({ action: "skip", reason: "matches-inw" });
  });

  it("skips a lagged GetItem after the seller saved or we pushed until two matching snapshots", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastPushedAt: new Date("2026-08-20T06:56:21.000Z"),
        inwUpdatedAt: new Date("2026-08-20T06:56:19.000Z"),
        lastInboundAt: new Date("2026-08-20T06:56:18.000Z"),
        remoteTitle: "Tachometer EBAY CRON TEST 5",
        inwTitle: "Tachometer",
        now: new Date("2026-08-20T07:10:00.000Z"),
      })
    ).toMatchObject({ action: "pending", reason: "await-confirm" });
  });

  it("skips GetItem without LastModified during the push echo window", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastPushedAt: new Date("2026-08-20T06:56:21.000Z"),
        remoteTitle: "Tachometer EBAY CRON TEST 6",
        now: new Date("2026-08-20T06:56:30.000Z"),
      })
    ).toEqual({ action: "skip", reason: "echo-of-push" });
  });

  it("waits for a second identical snapshot before applying a real eBay edit", () => {
    const first = ebayGetItemApplyDecision({
      ...base,
      remoteTitle: "Tachometer EBAY CRON TEST 6",
      now: new Date("2026-08-20T07:00:00.000Z"),
    });
    expect(first).toMatchObject({ action: "pending", reason: "await-confirm" });
    expect(first.pendingHash).toBeTruthy();
    expect(
      ebayGetItemApplyDecision({
        ...base,
        remoteTitle: "Tachometer EBAY CRON TEST 6",
        pendingRemoteHash: first.pendingHash,
        now: new Date("2026-08-20T07:05:00.000Z"),
      })
    ).toMatchObject({ action: "apply", reason: "confirmed-snapshot" });
  });

  it("does not apply a different snapshot than the one pending", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        remoteTitle: "Tachometer LIVE",
        pendingRemoteHash: "Tachometer LAGGED|4000|4",
      }).action
    ).toBe("pending");
  });

  it("applies a webhook revise without waiting for a second snapshot", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        remoteTitle: "Tachometer EBAY CRON TEST 6",
        source: "webhook",
        now: new Date("2026-08-20T07:00:00.000Z"),
      })
    ).toMatchObject({ action: "apply", reason: "webhook-revise" });
  });

  it("still skips a webhook GetItem that matches INW or is an echo of our push", () => {
    expect(ebayGetItemApplyDecision({ ...base, source: "webhook" })).toEqual({
      action: "skip",
      reason: "matches-inw",
    });
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastPushedAt: new Date("2026-08-20T06:56:21.000Z"),
        remoteTitle: "Tachometer EBAY CRON TEST 6",
        source: "webhook",
        now: new Date("2026-08-20T06:56:30.000Z"),
      })
    ).toEqual({ action: "skip", reason: "echo-of-push" });
  });

  it("applies a webhook revise when LastModified looks stale versus INW but fields differ", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        ebayLastModified: new Date("2026-08-20T06:40:00.000Z"),
        remoteTitle: "Tachometer LIVE FROM EBAY",
        source: "webhook",
        now: new Date("2026-08-20T07:00:00.000Z"),
      })
    ).toMatchObject({ action: "apply", reason: "webhook-revise" });
  });

  it("still skips a webhook LastModified that is only an echo of our push", () => {
    const pushedAt = new Date("2026-08-20T06:56:21.000Z");
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastPushedAt: pushedAt,
        ebayLastModified: new Date("2026-08-20T06:56:25.000Z"),
        remoteTitle: "Tachometer EBAY CRON TEST 6",
        source: "webhook",
        now: new Date("2026-08-20T06:56:30.000Z"),
      })
    ).toEqual({ action: "skip", reason: "echo-of-push" });
  });
});

describe("shouldApplyEbayInboundVariants", () => {
  const local = [
    {
      name: "Size",
      options: [
        { value: "S", quantity: 4 },
        { value: "M", quantity: 3 },
        { value: "L", quantity: 2 },
      ],
    },
  ];
  const pushedAt = new Date("2026-08-20T05:06:00.000Z");

  it("rejects a post-publish snapshot that dropped options", () => {
    expect(
      shouldApplyEbayInboundVariants({
        localVariants: local,
        remoteVariants: [
          {
            name: "Size",
            options: [
              { value: "S", quantity: 1 },
              { value: "M", quantity: 1 },
            ],
          },
        ],
        lastPushedAt: pushedAt,
        now: new Date("2026-08-20T05:10:00.000Z"),
      })
    ).toBe(false);
  });

  it("rejects all-qty-1 echo shortly after we pushed richer option stock", () => {
    expect(
      shouldApplyEbayInboundVariants({
        localVariants: local,
        remoteVariants: [
          {
            name: "Size",
            options: [
              { value: "S", quantity: 1 },
              { value: "M", quantity: 1 },
              { value: "L", quantity: 1 },
            ],
          },
        ],
        lastPushedAt: pushedAt,
        now: new Date("2026-08-20T05:10:00.000Z"),
      })
    ).toBe(false);
  });

  it("applies a later eBay edit that matches INW options with real quantities", () => {
    expect(
      shouldApplyEbayInboundVariants({
        localVariants: local,
        remoteVariants: [
          {
            name: "Size",
            options: [
              { value: "S", quantity: 4 },
              { value: "M", quantity: 2 },
              { value: "L", quantity: 2 },
            ],
          },
        ],
        lastPushedAt: pushedAt,
        now: new Date("2026-08-20T05:30:00.000Z"),
      })
    ).toBe(true);
  });

  it("applies remote variants when INW has none (import)", () => {
    expect(
      shouldApplyEbayInboundVariants({
        localVariants: null,
        remoteVariants: [
          { name: "Size", options: [{ value: "S", quantity: 1 }, { value: "M", quantity: 2 }] },
        ],
      })
    ).toBe(true);
  });
});

describe("ebay pending inbound hash", () => {
  it("stores and clears the pending snapshot on conflictDetails", () => {
    const withPending = withEbayPendingInbound({ other: 1 }, { hash: "a|1|1", seenAt: "t" });
    expect(readEbayPendingInboundHash(withPending)).toBe("a|1|1");
    expect((withPending as { other: number }).other).toBe(1);
    expect(readEbayPendingInboundHash(withEbayPendingInbound(withPending, null))).toBeNull();
  });
});
