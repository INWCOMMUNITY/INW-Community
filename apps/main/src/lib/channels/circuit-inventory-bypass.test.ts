import { describe, expect, it } from "vitest";
import { shouldBypassCircuitForInventoryPush } from "./circuit-inventory-bypass";

describe("shouldBypassCircuitForInventoryPush", () => {
  it("still pushes sold-out / zero qty while the circuit is open", () => {
    expect(
      shouldBypassCircuitForInventoryPush({ quantity: 0, status: "sold_out", adjustedQty: 0 })
    ).toBe(true);
    expect(
      shouldBypassCircuitForInventoryPush({ quantity: 0, status: "active", adjustedQty: 0 })
    ).toBe(true);
  });

  it("does not bypass for positive remaining stock", () => {
    expect(
      shouldBypassCircuitForInventoryPush({ quantity: 3, status: "active", adjustedQty: 3 })
    ).toBe(false);
  });
});
