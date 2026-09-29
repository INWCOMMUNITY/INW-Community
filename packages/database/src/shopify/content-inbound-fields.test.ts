import { describe, expect, it } from "vitest";
import { planShopifyFieldLevelSync } from "./field-semantic";
import { shopifyDescriptionFieldFingerprint, shopifyFieldFingerprint } from "./field-fingerprint";

describe("adaptive field merge scenarios (UNIT 2)", () => {
  it("INW title + Shopify price merge without conflict", () => {
    const baseTitle = shopifyFieldFingerprint("TITLE", "Blue Bowl");
    const localTitle = shopifyFieldFingerprint("TITLE", "Large Blue Bowl");
    const remoteTitle = baseTitle;
    const basePrice = shopifyFieldFingerprint("PRICE", 1000);
    const localPrice = basePrice;
    const remotePrice = shopifyFieldFingerprint("PRICE", 1200);

    const plan = planShopifyFieldLevelSync([
      { field: "TITLE", base: baseTitle, local: localTitle, remote: remoteTitle },
      {
        field: "PRICE",
        storeVariantId: "var-1",
        base: basePrice,
        local: localPrice,
        remote: remotePrice,
      },
    ]);

    expect(plan.anyConflict).toBe(false);
    expect(plan.pushFields.map((p) => p.field)).toEqual(["TITLE"]);
    expect(plan.pullFields.map((p) => p.field)).toEqual(["PRICE"]);
  });

  it("same-field title divergence conflicts; unrelated description can still pull", () => {
    const base = shopifyFieldFingerprint("TITLE", "A");
    const plan = planShopifyFieldLevelSync([
      {
        field: "TITLE",
        base,
        local: shopifyFieldFingerprint("TITLE", "B"),
        remote: shopifyFieldFingerprint("TITLE", "C"),
      },
      {
        field: "DESCRIPTION",
        base: shopifyDescriptionFieldFingerprint("old"),
        local: shopifyDescriptionFieldFingerprint("old"),
        remote: shopifyDescriptionFieldFingerprint("new remote"),
      },
    ]);
    expect(plan.plans.find((p) => p.field === "TITLE")?.action).toBe("CONFLICT");
    expect(plan.plans.find((p) => p.field === "DESCRIPTION")?.action).toBe("PULL_REMOTE");
  });

  it("SKU change does not imply identity remap — fingerprint only", () => {
    const a = shopifyFieldFingerprint("SKU", "SKU-1");
    const b = shopifyFieldFingerprint("SKU", "SKU-2");
    expect(a).not.toBe(b);
    const plan = planShopifyFieldLevelSync([
      { field: "SKU", storeVariantId: "var-1", base: a, local: b, remote: a },
    ]);
    expect(plan.pushFields[0]?.action).toBe("PUSH_LOCAL");
  });
});
