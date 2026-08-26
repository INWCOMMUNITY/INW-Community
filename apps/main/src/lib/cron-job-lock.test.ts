import { describe, expect, it } from "vitest";
import { SYNC_CHANNELS_LOCK_TTL_MS, INBOUND_CATALOG_LOCK_TTL_MS } from "./cron-job-lock";
import { shouldAdvanceLastReconciledAt } from "./channels/reconcile";

describe("sync-channels lock TTL", () => {
  it("is longer than Vercel maxDuration so the next tick cannot steal a live run", () => {
    expect(SYNC_CHANNELS_LOCK_TTL_MS).toBeGreaterThanOrEqual(320_000);
  });

  it("gives inbound catalog enough exclusive time to finish without overlapping webhooks", () => {
    expect(INBOUND_CATALOG_LOCK_TTL_MS).toBeGreaterThanOrEqual(120_000);
  });
});

describe("shouldAdvanceLastReconciledAt", () => {
  it("advances only after a successful sales fetch", () => {
    expect(shouldAdvanceLastReconciledAt({ salesFetched: true, paused: false })).toBe(true);
  });

  it("does not advance after a failed fetch or pause (would drop later sales)", () => {
    expect(shouldAdvanceLastReconciledAt({ salesFetched: false, paused: false })).toBe(false);
    expect(shouldAdvanceLastReconciledAt({ salesFetched: false, paused: true })).toBe(false);
  });
});
