import { describe, expect, it } from "vitest";
import {
  inboundSaleClaimDecision,
  UNAPPLIED_CLAIM_STALE_MS,
} from "./apply-channel-sale";

const now = Date.parse("2026-08-25T20:00:00.000Z");

describe("inboundSaleClaimDecision", () => {
  it("applies when no event exists", () => {
    expect(inboundSaleClaimDecision(null, now)).toBe("missing");
  });

  it("treats appliedAt as already done (webhook ∥ cron)", () => {
    expect(
      inboundSaleClaimDecision(
        { appliedAt: new Date(now - 1000), type: "sale", processedAt: new Date(now - 1000) },
        now
      )
    ).toBe("duplicate");
  });

  it("treats sale_ack_absolute as already done even without appliedAt", () => {
    expect(
      inboundSaleClaimDecision(
        { appliedAt: null, type: "sale_ack_absolute", processedAt: new Date(now) },
        now
      )
    ).toBe("duplicate");
  });

  it("skips a fresh unapplied claim so two workers cannot both decrement", () => {
    expect(
      inboundSaleClaimDecision(
        { appliedAt: null, type: "sale", processedAt: new Date(now - 30_000) },
        now
      )
    ).toBe("in_flight");
  });

  it("retries a stale unapplied claim after crash between claim and decrement", () => {
    expect(
      inboundSaleClaimDecision(
        {
          appliedAt: null,
          type: "sale",
          processedAt: new Date(now - UNAPPLIED_CLAIM_STALE_MS - 1),
        },
        now
      )
    ).toBe("retry_unapplied");
  });
});
