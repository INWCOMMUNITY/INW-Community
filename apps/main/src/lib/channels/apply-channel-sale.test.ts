import { describe, expect, it } from "vitest";
import {
  inboundSaleClaimDecision,
  oversellAlertMessage,
  UNAPPLIED_CLAIM_STALE_MS,
} from "./apply-channel-sale";
import { zeroAllVariantQuantities } from "@/lib/store-item-variants";

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

describe("oversellAlertMessage", () => {
  it("names the channel and both quantities so the seller can reconcile stock", () => {
    const msg = oversellAlertMessage({ provider: "ebay", requested: 3, available: 1 });
    expect(msg).toContain("eBay");
    expect(msg).toContain("3");
    expect(msg).toContain("1");
    expect(msg.toLowerCase()).toContain("sold out");
  });

  it("falls back to the raw provider id for unknown providers", () => {
    const msg = oversellAlertMessage({
      provider: "mystery" as never,
      requested: 2,
      available: 0,
    });
    expect(msg).toContain("mystery");
  });
});

describe("zeroAllVariantQuantities", () => {
  it("zeros every per-option quantity (single-axis legacy shape)", () => {
    const out = zeroAllVariantQuantities([
      { name: "Size", options: [{ value: "S", quantity: 4 }, { value: "M", quantity: 2 }] },
    ]) as { options: { quantity: number }[] }[];
    expect(out[0].options.map((o) => o.quantity)).toEqual([0, 0]);
  });

  it("zeros every SKU quantity (matrix shape)", () => {
    const out = zeroAllVariantQuantities({
      axes: [{ name: "Size", values: ["S", "M"] }],
      skus: [
        { options: { Size: "S" }, quantity: 5 },
        { options: { Size: "M" }, quantity: 3 },
      ],
    }) as { skus: { quantity: number }[] };
    expect(out.skus.map((s) => s.quantity)).toEqual([0, 0]);
  });

  it("leaves non-option listings untouched", () => {
    expect(zeroAllVariantQuantities(null)).toBeNull();
    const legacy = [{ name: "Color", options: ["Red", "Blue"] }];
    expect(zeroAllVariantQuantities(legacy)).toEqual(legacy);
  });
});
