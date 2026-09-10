import { describe, expect, it } from "vitest";
import {
  hydrateCircuitFromConfig,
  inboundReconcileShouldPull,
  resetCircuit,
} from "./circuit-breaker";

describe("inboundReconcileShouldPull", () => {
  it("pulls for a healthy (closed) circuit", () => {
    const id = "conn-inbound-closed";
    void resetCircuit(id, "ebay");
    expect(inboundReconcileShouldPull(id)).toBe(true);
  });

  it("backs off inbound pulls while the circuit is open (don't hammer a failing shop)", () => {
    const id = "conn-inbound-open";
    // A durable outage (5xx) persisted an OPEN circuit; hydrate it as if after a cold start.
    hydrateCircuitFromConfig(id, {
      circuitBreaker: {
        state: "OPEN",
        openedAt: new Date().toISOString(),
        lastError: "503 Service Unavailable",
      },
    });
    expect(inboundReconcileShouldPull(id)).toBe(false);
  });

  it("does not treat a stale listing-level 400 pause as a reason to skip inbound", () => {
    const id = "conn-inbound-listing-level";
    // who_made is a listing-level validation error — it must not pause the whole shop's inbound.
    hydrateCircuitFromConfig(id, {
      circuitBreaker: {
        state: "OPEN",
        openedAt: new Date().toISOString(),
        lastError: "who_made is required",
      },
    });
    expect(inboundReconcileShouldPull(id)).toBe(true);
  });
});
