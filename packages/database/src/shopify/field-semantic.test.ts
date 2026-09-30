import { describe, expect, it } from "vitest";
import { planShopifyFieldLevelSync } from "./field-semantic";

const A = "fp-A";
const B = "fp-B";
const C = "fp-C";

describe("planShopifyFieldLevelSync", () => {
  it("merges independent field edits without conflict", () => {
    const result = planShopifyFieldLevelSync([
      { field: "TITLE", base: A, local: B, remote: A },
      { field: "PRICE", storeVariantId: "var-1", base: A, local: A, remote: C },
    ]);
    expect(result.anyConflict).toBe(false);
    expect(result.pushFields.map((p) => p.field)).toEqual(["TITLE"]);
    expect(result.pullFields.map((p) => p.field)).toEqual(["PRICE"]);
  });

  it("conflicts only the same semantic field when both diverge", () => {
    const result = planShopifyFieldLevelSync([
      { field: "TITLE", base: A, local: B, remote: C },
      { field: "PRICE", storeVariantId: "var-1", base: A, local: B, remote: A },
    ]);
    expect(result.anyConflict).toBe(true);
    expect(result.plans.find((p) => p.field === "TITLE")?.action).toBe("CONFLICT");
    expect(result.plans.find((p) => p.field === "PRICE")?.action).toBe("PUSH_LOCAL");
  });

  it("treats equal local/remote as converged even when base differs", () => {
    const result = planShopifyFieldLevelSync([
      { field: "SKU", storeVariantId: "var-1", base: A, local: B, remote: B },
    ]);
    expect(result.plans[0]?.action).toBe("CONVERGED");
    expect(result.anyConflict).toBe(false);
  });

  it("does not use arrival order — fingerprints alone decide", () => {
    const early = planShopifyFieldLevelSync([
      { field: "DESCRIPTION", base: A, local: B, remote: A },
    ]);
    const late = planShopifyFieldLevelSync([
      { field: "DESCRIPTION", base: A, local: B, remote: A },
    ]);
    expect(early.plans[0]?.action).toBe(late.plans[0]?.action);
    expect(early.plans[0]?.action).toBe("PUSH_LOCAL");
  });
});
