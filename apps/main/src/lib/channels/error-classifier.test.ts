import { describe, expect, it } from "vitest";
import { shouldCountTowardCircuit } from "./error-classifier";

describe("shouldCountTowardCircuit", () => {
  it("counts connection outages", () => {
    expect(shouldCountTowardCircuit("503 Service Unavailable")).toBe(true);
    expect(shouldCountTowardCircuit({ status: 429, message: "Too many requests" })).toBe(true);
    expect(shouldCountTowardCircuit(new Error("ETIMEDOUT"))).toBe(true);
  });

  it("does not pause the shop for listing-level errors after an Etsy edit", () => {
    expect(
      shouldCountTowardCircuit("Etsy inventory verify failed for listing 1: expected 3, got 2")
    ).toBe(false);
    expect(shouldCountTowardCircuit({ status: 409, message: "conflict" })).toBe(false);
    expect(shouldCountTowardCircuit({ status: 400, message: "who_made is required" })).toBe(false);
    expect(
      shouldCountTowardCircuit(
        "Cannot update 'when_made' without 'who_made' and  without 'is_supply' and vice versa"
      )
    ).toBe(false);
    expect(
      shouldCountTowardCircuit({
        status: 400,
        message: "marketplace: Oh dear, you cannot sell this item on Etsy.",
      })
    ).toBe(false);
    expect(shouldCountTowardCircuit(new Error("invalid_grant"))).toBe(false);
  });
});
