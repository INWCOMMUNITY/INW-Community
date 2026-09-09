import { describe, expect, it } from "vitest";
import {
  inwChangedSinceBaseline,
  inwSavedAfterChannelPush,
  newerChannelEditShouldPull,
  resolveSyncDirection,
  shouldBlockOutboundOverwrite,
  syncContentHash,
} from "./sync-baseline";

describe("syncContentHash", () => {
  it("ignores Wix CDN file-id churn at the same photo count", () => {
    const a = syncContentHash({
      title: "Shadow Gate",
      description: "<p>Complete in box.</p>",
      priceCents: 6000,
      photos: ["https://static.wixstatic.com/media/2bdd49_aaa~mv2.jpg"],
    });
    const b = syncContentHash({
      title: "Shadow Gate",
      description: "Complete in box.",
      priceCents: 6000,
      photos: ["https://static.wixstatic.com/media/2bdd49_bbb~mv2.jpg"],
    });
    expect(a).toBe(b);
  });

  it("changes when INW Blob photo URLs change", () => {
    const a = syncContentHash({
      title: "Shadow Gate",
      description: "CIB",
      priceCents: 6000,
      photos: ["https://abc.public.blob.vercel-storage.com/old.jpg"],
    });
    const b = syncContentHash({
      title: "Shadow Gate",
      description: "CIB",
      priceCents: 6000,
      photos: ["https://abc.public.blob.vercel-storage.com/new.jpg"],
    });
    expect(a).not.toBe(b);
  });
});

describe("inwChangedSinceBaseline", () => {
  const baselineAt = new Date("2026-09-08T17:00:00.000Z");

  it("is false when hashes match even if INW was saved later", () => {
    expect(
      inwChangedSinceBaseline({
        hashDiffers: false,
        inwUpdatedAt: new Date("2026-09-08T18:00:00.000Z"),
        baselineAt,
      })
    ).toBe(false);
  });

  it("is false when hashes drifted but INW was not saved after the baseline", () => {
    expect(
      inwChangedSinceBaseline({
        hashDiffers: true,
        inwUpdatedAt: new Date("2026-09-01T00:00:00.000Z"),
        baselineAt,
      })
    ).toBe(false);
  });

  it("is true when hashes differ and INW was saved after the baseline", () => {
    expect(
      inwChangedSinceBaseline({
        hashDiffers: true,
        inwUpdatedAt: new Date("2026-09-08T17:30:00.000Z"),
        baselineAt,
      })
    ).toBe(true);
  });
});

describe("newerChannelEditShouldPull", () => {
  const inwUpdatedAt = new Date("2026-09-08T16:00:00.000Z");
  const baselineAt = new Date("2026-09-08T16:00:00.000Z");

  it("pulls a marketplace save that is newer than INW", () => {
    expect(
      newerChannelEditShouldPull({
        remoteContentDiffers: true,
        inwUpdatedAt,
        remoteUpdatedAt: new Date("2026-09-08T17:40:26.798Z"),
        baselineAt,
      })
    ).toBe(true);
  });

  it("does not pull when the channel listing still matches INW", () => {
    expect(
      newerChannelEditShouldPull({
        remoteContentDiffers: false,
        inwUpdatedAt,
        remoteUpdatedAt: new Date("2026-09-08T17:40:26.798Z"),
        baselineAt,
      })
    ).toBe(false);
  });

  it("does not pull inside the post-push echo window", () => {
    expect(
      newerChannelEditShouldPull({
        remoteContentDiffers: true,
        inwUpdatedAt,
        remoteUpdatedAt: new Date("2026-09-08T17:40:26.798Z"),
        baselineAt: new Date(Date.now() + 45_000),
      })
    ).toBe(false);
  });

  it("pulls a differing Etsy listing when last_modified is missing and INW was not saved after baseline", () => {
    expect(
      newerChannelEditShouldPull({
        remoteContentDiffers: true,
        inwUpdatedAt,
        remoteUpdatedAt: null,
        baselineAt,
      })
    ).toBe(true);
  });

  it("does not pull a missing-timestamp remote when INW was saved after baseline", () => {
    expect(
      newerChannelEditShouldPull({
        remoteContentDiffers: true,
        inwUpdatedAt: new Date("2026-09-08T17:00:00.000Z"),
        remoteUpdatedAt: null,
        baselineAt,
      })
    ).toBe(false);
  });
});

describe("shouldBlockOutboundOverwrite", () => {
  const inwUpdatedAt = new Date("2026-09-08T16:00:00.000Z");
  const lastPushedAt = new Date("2026-09-08T16:00:00.000Z");

  it("blocks pushing an old INW title over a newer Etsy save", () => {
    expect(
      shouldBlockOutboundOverwrite({
        titlesDiffer: true,
        inwUpdatedAt,
        remoteUpdatedAt: new Date("2026-09-08T17:40:26.798Z"),
        lastPushedAt,
      })
    ).toBe(true);
  });

  it("allows a real INW title save to push", () => {
    expect(
      shouldBlockOutboundOverwrite({
        titlesDiffer: true,
        inwUpdatedAt: new Date("2026-09-08T18:00:00.000Z"),
        remoteUpdatedAt: new Date("2026-09-08T17:00:00.000Z"),
        lastPushedAt,
      })
    ).toBe(false);
  });

  it("does not block when titles already match", () => {
    expect(
      shouldBlockOutboundOverwrite({
        titlesDiffer: false,
        inwUpdatedAt,
        remoteUpdatedAt: new Date("2026-09-08T17:40:26.798Z"),
        lastPushedAt,
      })
    ).toBe(false);
  });
});

describe("inwSavedAfterChannelPush", () => {
  it("is true when INW was saved after the last successful channel write", () => {
    expect(
      inwSavedAfterChannelPush({
        inwUpdatedAt: new Date("2026-09-09T01:25:10.000Z"),
        lastPushedAt: new Date("2026-09-09T01:20:00.000Z"),
      })
    ).toBe(true);
  });

  it("is false after a successful push that landed after the INW save", () => {
    expect(
      inwSavedAfterChannelPush({
        inwUpdatedAt: new Date("2026-09-09T01:25:10.000Z"),
        lastPushedAt: new Date("2026-09-09T01:25:20.000Z"),
      })
    ).toBe(false);
  });

  it("is true when this channel has never been pushed", () => {
    expect(
      inwSavedAfterChannelPush({
        inwUpdatedAt: new Date("2026-09-09T01:25:10.000Z"),
        lastPushedAt: null,
      })
    ).toBe(true);
  });
});

describe("resolveSyncDirection", () => {
  const inwUpdatedAt = new Date("2026-09-08T16:00:00.000Z");
  const remoteUpdatedAt = new Date("2026-09-08T17:40:26.798Z");

  it("pulls a channel-only edit even when conflict resolution is inw_wins", () => {
    expect(
      resolveSyncDirection({
        inwChanged: false,
        remoteChanged: true,
        inwUpdatedAt,
        remoteUpdatedAt,
        conflictResolution: "inw_wins",
      })
    ).toBe("pull");
  });

  it("pushes when both sides changed and inw_wins is set", () => {
    expect(
      resolveSyncDirection({
        inwChanged: true,
        remoteChanged: true,
        inwUpdatedAt,
        remoteUpdatedAt,
        conflictResolution: "inw_wins",
      })
    ).toBe("push");
  });
});
