import { describe, expect, it } from "vitest";
import { shopifyDescriptionFieldFingerprint, shopifyFieldFingerprint } from "./field-fingerprint";
import { planShopifyFieldLevelSync } from "./field-semantic";
import { planShopifyOutboundContentFields } from "./content-outbound-fields";

/**
 * Unit 8: cross-field merge — independent fields converge without same-field overwrite.
 */
describe("adaptive cross-field merge", () => {
  it("merges LOCAL title with REMOTE description without conflict", () => {
    const plan = planShopifyFieldLevelSync([
      {
        field: "TITLE",
        base: shopifyFieldFingerprint("TITLE", "Old"),
        local: shopifyFieldFingerprint("TITLE", "INW Title"),
        remote: shopifyFieldFingerprint("TITLE", "Old"),
        hasLocalSemanticEdit: true,
      },
      {
        field: "DESCRIPTION",
        base: shopifyDescriptionFieldFingerprint("Old Desc"),
        local: shopifyDescriptionFieldFingerprint("Old Desc"),
        remote: shopifyDescriptionFieldFingerprint("Shopify Desc"),
        hasLocalSemanticEdit: true,
      },
      {
        field: "PRICE",
        storeVariantId: "v1",
        base: shopifyFieldFingerprint("PRICE", 1000),
        local: shopifyFieldFingerprint("PRICE", 1000),
        remote: shopifyFieldFingerprint("PRICE", 1000),
      },
      {
        field: "SKU",
        storeVariantId: "v1",
        base: shopifyFieldFingerprint("SKU", "A"),
        local: shopifyFieldFingerprint("SKU", "A"),
        remote: shopifyFieldFingerprint("SKU", "A"),
      },
    ]);
    expect(plan.anyConflict).toBe(false);
    expect(plan.pushFields.map((p) => p.field)).toEqual(["TITLE"]);
    expect(plan.pullFields.map((p) => p.field)).toEqual(["DESCRIPTION"]);
  });

  it("outbound pushes only LOCAL_ONLY fields after mixed inbound plan", () => {
    const outbound = planShopifyOutboundContentFields({
      title: {
        base: shopifyFieldFingerprint("TITLE", "Old"),
        local: "INW Title",
        remote: "Old",
        hasLocalSemanticEdit: true,
      },
      description: {
        base: shopifyDescriptionFieldFingerprint("Shopify Desc"),
        local: "Shopify Desc",
        remote: "Shopify Desc",
        hasLocalSemanticEdit: true,
      },
      price: {
        storeVariantId: "v1",
        base: shopifyFieldFingerprint("PRICE", 999),
        localCents: 1037,
        remoteCents: 999,
        hasLocalSemanticEdit: true,
      },
      sku: {
        storeVariantId: "v1",
        base: shopifyFieldFingerprint("SKU", "OLD"),
        local: "OLD",
        remote: "OLD",
        hasLocalSemanticEdit: true,
      },
    });
    expect(outbound.pushTitle).toBe(true);
    expect(outbound.pushDescription).toBe(false);
    expect(outbound.pushPrice).toBe(true);
    expect(outbound.pushSku).toBe(false);
    expect(outbound.productConflict).toBe(false);
    expect(outbound.variantConflict).toBe(false);
  });

  it("same-field dual edit conflicts without clock guessing", () => {
    const plan = planShopifyFieldLevelSync([
      {
        field: "TITLE",
        base: shopifyFieldFingerprint("TITLE", "Old"),
        local: shopifyFieldFingerprint("TITLE", "INW"),
        remote: shopifyFieldFingerprint("TITLE", "Shopify"),
        hasLocalSemanticEdit: true,
      },
    ]);
    expect(plan.anyConflict).toBe(true);
    expect(plan.pushFields).toHaveLength(0);
    expect(plan.pullFields).toHaveLength(0);
  });

  it("bidirectional LWW: Shopify-only title edit pulls into INW", () => {
    const plan = planShopifyFieldLevelSync([
      {
        field: "TITLE",
        base: shopifyFieldFingerprint("TITLE", "Old"),
        local: shopifyFieldFingerprint("TITLE", "Old"),
        remote: shopifyFieldFingerprint("TITLE", "Shopify Newer"),
        hasLocalSemanticEdit: false,
      },
    ]);
    expect(plan.anyConflict).toBe(false);
    expect(plan.pullFields.map((p) => p.field)).toEqual(["TITLE"]);
    expect(plan.pushFields).toHaveLength(0);
  });

  it("bidirectional LWW: later INW title after Shopify base pushes outbound", () => {
    // After Shopify edit was pulled, BASE=LOCAL=REMOTE=Shopify. Then INW edits again.
    const plan = planShopifyFieldLevelSync([
      {
        field: "TITLE",
        base: shopifyFieldFingerprint("TITLE", "Shopify Newer"),
        local: shopifyFieldFingerprint("TITLE", "INW Newest"),
        remote: shopifyFieldFingerprint("TITLE", "Shopify Newer"),
        hasLocalSemanticEdit: true,
      },
    ]);
    expect(plan.anyConflict).toBe(false);
    expect(plan.pushFields.map((p) => p.field)).toEqual(["TITLE"]);
    expect(plan.pullFields).toHaveLength(0);
  });

  it("bidirectional LWW: self-echo of INW push is converged not a pull", () => {
    const plan = planShopifyFieldLevelSync([
      {
        field: "TITLE",
        base: shopifyFieldFingerprint("TITLE", "Old"),
        local: shopifyFieldFingerprint("TITLE", "INW Title"),
        remote: shopifyFieldFingerprint("TITLE", "INW Title"),
        hasLocalSemanticEdit: true,
      },
    ]);
    expect(plan.anyConflict).toBe(false);
    expect(plan.pushFields).toHaveLength(0);
    expect(plan.pullFields).toHaveLength(0);
    expect(plan.plans[0]?.action).toMatch(/CONVERGED|UNCHANGED/);
  });
});
