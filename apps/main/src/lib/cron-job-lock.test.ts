import { describe, expect, it } from "vitest";
import {
  SYNC_CHANNELS_LOCK_TTL_MS,
  INBOUND_CATALOG_LOCK_TTL_MS,
  shouldRenewCronLock,
} from "./cron-job-lock";
import {
  shouldAdvanceLastReconciledAt,
  reconcileTimeBudgetExhausted,
} from "./channels/reconcile";

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

describe("shouldRenewCronLock", () => {
  it("renews every Nth processed item and never on the first", () => {
    expect(shouldRenewCronLock(0)).toBe(false);
    expect(shouldRenewCronLock(24)).toBe(false);
    expect(shouldRenewCronLock(25)).toBe(true);
    expect(shouldRenewCronLock(50)).toBe(true);
  });

  it("honors a custom cadence", () => {
    expect(shouldRenewCronLock(10, 10)).toBe(true);
    expect(shouldRenewCronLock(9, 10)).toBe(false);
  });
});

describe("reconcileTimeBudgetExhausted", () => {
  it("is never exhausted without a deadline", () => {
    expect(reconcileTimeBudgetExhausted(undefined, 10_000)).toBe(false);
  });

  it("stops once the wall-clock deadline is reached", () => {
    expect(reconcileTimeBudgetExhausted(10_000, 9_999)).toBe(false);
    expect(reconcileTimeBudgetExhausted(10_000, 10_000)).toBe(true);
    expect(reconcileTimeBudgetExhausted(10_000, 10_001)).toBe(true);
  });
});
