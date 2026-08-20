import { describe, it, expect } from "vitest";
import { cachedEtsyReadinessStateId } from "./readiness";

describe("cachedEtsyReadinessStateId", () => {
  it("returns a positive integer from connection config", () => {
    expect(cachedEtsyReadinessStateId({ defaultReadinessStateId: 17 })).toBe(17);
  });

  it("ignores missing or invalid values", () => {
    expect(cachedEtsyReadinessStateId(null)).toBeNull();
    expect(cachedEtsyReadinessStateId({})).toBeNull();
    expect(cachedEtsyReadinessStateId({ defaultReadinessStateId: 0 })).toBeNull();
    expect(cachedEtsyReadinessStateId({ defaultReadinessStateId: "17" })).toBeNull();
  });
});
