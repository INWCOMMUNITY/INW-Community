import { describe, expect, it } from "vitest";
import {
  classifyShopifyDirectInventoryEdit,
  shouldPauseInventoryForDirectShopifyEdit,
} from "./inventory-direct-edit";

describe("classifyShopifyDirectInventoryEdit", () => {
  it("treats unexplained Shopify qty as direct edit (not LWW into Foundation)", () => {
    const cls = classifyShopifyDirectInventoryEdit({
      remoteAvailable: 7,
      desiredAvailable: 10,
      appliedAvailable: 10,
    });
    expect(cls).toBe("UNEXPLAINED_REMOTE_EDIT");
    expect(shouldPauseInventoryForDirectShopifyEdit(cls)).toBe(true);
  });

  it("accepts sale-explained remote deltas without pause", () => {
    const cls = classifyShopifyDirectInventoryEdit({
      remoteAvailable: 9,
      desiredAvailable: 9,
      appliedAvailable: 10,
      explainedDelta: -1,
    });
    expect(cls).toBe("MATCHES_DESIRED");
    expect(shouldPauseInventoryForDirectShopifyEdit(cls)).toBe(false);
  });

  it("allows safe CAS when remote still equals applied base", () => {
    expect(
      classifyShopifyDirectInventoryEdit({
        remoteAvailable: 10,
        desiredAvailable: 8,
        appliedAvailable: 10,
      })
    ).toBe("MATCHES_APPLIED_BASE");
  });
});
