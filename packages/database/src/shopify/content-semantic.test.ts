import { describe, expect, it } from "vitest";
import { classifyShopifyContentSemantics } from "./content-semantic";

const A = "fp-A";
const B = "fp-B";
const C = "fp-C";
const D = "fp-D";

describe("classifyShopifyContentSemantics", () => {
  it("classifies UNCHANGED when all three match", () => {
    expect(classifyShopifyContentSemantics({ base: A, local: A, remote: A })).toBe("UNCHANGED");
  });

  it("classifies CONVERGED when local == remote and differs from base", () => {
    expect(classifyShopifyContentSemantics({ base: A, local: C, remote: C })).toBe("CONVERGED");
  });

  it("classifies LOCAL_ONLY when only local diverged", () => {
    expect(classifyShopifyContentSemantics({ base: A, local: C, remote: A })).toBe("LOCAL_ONLY");
  });

  it("classifies REMOTE_ONLY when only remote diverged", () => {
    expect(classifyShopifyContentSemantics({ base: A, local: A, remote: B })).toBe("REMOTE_ONLY");
  });

  it("classifies CONFLICT when both diverge differently", () => {
    expect(classifyShopifyContentSemantics({ base: A, local: C, remote: B })).toBe("CONFLICT");
  });

  it("ignores wall-clock context — same fingerprints keep LOCAL_ONLY", () => {
    // Extreme timestamps must not change classification (fingerprints only).
    expect(classifyShopifyContentSemantics({ base: A, local: C, remote: A })).toBe("LOCAL_ONLY");
    expect(classifyShopifyContentSemantics({ base: A, local: C, remote: A })).toBe("LOCAL_ONLY");
  });

  it("same remote fingerprint is not a new semantic edit", () => {
    // Fingerprint B == BASE remains LOCAL_ONLY even if Shopify updatedAt advanced.
    expect(classifyShopifyContentSemantics({ base: B, local: C, remote: B })).toBe("LOCAL_ONLY");
  });

  describe("null base bootstrap", () => {
    it("LOCAL == REMOTE → CONVERGED (initialize)", () => {
      expect(
        classifyShopifyContentSemantics({
          base: null,
          local: A,
          remote: A,
          hasLocalSemanticEdit: false,
        })
      ).toBe("CONVERGED");
    });

    it("LOCAL != REMOTE and no local edit → REMOTE_ONLY", () => {
      expect(
        classifyShopifyContentSemantics({
          base: null,
          local: A,
          remote: B,
          hasLocalSemanticEdit: false,
        })
      ).toBe("REMOTE_ONLY");
    });

    it("LOCAL != REMOTE with local edit → CONFLICT (no clock guess)", () => {
      expect(
        classifyShopifyContentSemantics({
          base: null,
          local: C,
          remote: B,
          hasLocalSemanticEdit: true,
        })
      ).toBe("CONFLICT");
    });
  });

  it("seller resolution path: new local D after conflict still classifies from fingerprints", () => {
    // After seller clears conflict and advances desire to D with BASE still A:
    expect(classifyShopifyContentSemantics({ base: A, local: D, remote: B })).toBe("CONFLICT");
    expect(classifyShopifyContentSemantics({ base: A, local: D, remote: A })).toBe("LOCAL_ONLY");
    expect(classifyShopifyContentSemantics({ base: A, local: D, remote: D })).toBe("CONVERGED");
  });
});
