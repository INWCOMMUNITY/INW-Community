import { describe, expect, it, vi } from "vitest";
import { classifyShopifyDirectInventoryEdit } from "./inventory-direct-edit";

describe("direct inventory edit causality matrix", () => {
  it("A: unexplained remote drop is UNEXPLAINED_REMOTE_EDIT (manual candidate)", () => {
    expect(
      classifyShopifyDirectInventoryEdit({
        remoteAvailable: 7,
        desiredAvailable: 10,
        appliedAvailable: 10,
      })
    ).toBe("UNEXPLAINED_REMOTE_EDIT");
  });

  it("B: sale-explained delta is not a manual edit", () => {
    expect(
      classifyShopifyDirectInventoryEdit({
        remoteAvailable: 8,
        desiredAvailable: 8,
        appliedAvailable: 10,
        explainedDelta: -2,
      })
    ).toBe("MATCHES_DESIRED");
  });

  it("D: self projection match is MATCHES_DESIRED", () => {
    expect(
      classifyShopifyDirectInventoryEdit({
        remoteAvailable: 6,
        desiredAvailable: 6,
        appliedAvailable: 10,
      })
    ).toBe("MATCHES_DESIRED");
  });

  it("F: applied-base match allows SAFE path classification", () => {
    expect(
      classifyShopifyDirectInventoryEdit({
        remoteAvailable: 10,
        desiredAvailable: 8,
        appliedAvailable: 10,
      })
    ).toBe("MATCHES_APPLIED_BASE");
  });
});

describe("applyShopifyInventoryLevelObservation unit seams", () => {
  it("exports apply function", async () => {
    const mod = await import("./inventory-levels-inbound");
    expect(typeof mod.applyShopifyInventoryLevelObservation).toBe("function");
  });
});
