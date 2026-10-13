import { describe, expect, it } from "vitest";
import { qtyObservationRevertsRecentChange } from "./commerce-foundation-inventory";

const now = new Date("2026-10-12T22:00:00Z");

describe("qtyObservationRevertsRecentChange", () => {
  it("blocks a marketplace read of the qty INW just left", () => {
    expect(
      qtyObservationRevertsRecentChange({
        currentOnHand: 10,
        targetOnHand: 4,
        previousOnHand: 4,
        changedAt: new Date(now.getTime() - 60_000),
        now,
      })
    ).toBe(true);
  });

  it("accepts a different quantity immediately", () => {
    expect(
      qtyObservationRevertsRecentChange({
        currentOnHand: 10,
        targetOnHand: 7,
        previousOnHand: 4,
        changedAt: new Date(now.getTime() - 60_000),
        now,
      })
    ).toBe(false);
  });

  it("accepts the previous quantity after the catch-up window", () => {
    expect(
      qtyObservationRevertsRecentChange({
        currentOnHand: 10,
        targetOnHand: 4,
        previousOnHand: 4,
        changedAt: new Date(now.getTime() - 11 * 60_000),
        now,
      })
    ).toBe(false);
  });
});
