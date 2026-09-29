import { describe, expect, it } from "vitest";
import { shopifyDescriptionFieldFingerprint, shopifyFieldFingerprint } from "./field-fingerprint";
import { planShopifyOutboundContentFields } from "./content-outbound-fields";

describe("planShopifyOutboundContentFields", () => {
  it("pushes only LOCAL_ONLY title while leaving REMOTE_ONLY description", () => {
    const baseTitle = shopifyFieldFingerprint("TITLE", "Old");
    const baseDesc = shopifyDescriptionFieldFingerprint("Old Desc");
    const plan = planShopifyOutboundContentFields({
      title: {
        base: baseTitle,
        local: "New Title",
        remote: "Old",
        hasLocalSemanticEdit: true,
      },
      description: {
        base: baseDesc,
        local: "Old Desc",
        remote: "Shopify Desc",
        hasLocalSemanticEdit: true,
      },
      price: {
        storeVariantId: "v1",
        base: shopifyFieldFingerprint("PRICE", 100),
        localCents: 100,
        remoteCents: 100,
        hasLocalSemanticEdit: false,
      },
      sku: {
        storeVariantId: "v1",
        base: shopifyFieldFingerprint("SKU", "A"),
        local: "A",
        remote: "A",
        hasLocalSemanticEdit: false,
      },
    });
    expect(plan.pushTitle).toBe(true);
    expect(plan.pushDescription).toBe(false);
    expect(plan.needsProductMutation).toBe(true);
    expect(plan.productConflict).toBe(false);
    expect(plan.productConverged).toBe(false);
  });

  it("conflicts same-field dual divergence without pushing", () => {
    const baseTitle = shopifyFieldFingerprint("TITLE", "Old");
    const plan = planShopifyOutboundContentFields({
      title: {
        base: baseTitle,
        local: "INW Title",
        remote: "Shopify Title",
        hasLocalSemanticEdit: true,
      },
      description: {
        base: shopifyDescriptionFieldFingerprint("Same"),
        local: "Same",
        remote: "Same",
        hasLocalSemanticEdit: true,
      },
      price: {
        storeVariantId: "v1",
        base: shopifyFieldFingerprint("PRICE", 100),
        localCents: 100,
        remoteCents: 100,
        hasLocalSemanticEdit: false,
      },
      sku: {
        storeVariantId: "v1",
        base: shopifyFieldFingerprint("SKU", "A"),
        local: "A",
        remote: "A",
        hasLocalSemanticEdit: false,
      },
    });
    expect(plan.productConflict).toBe(true);
    expect(plan.needsProductMutation).toBe(false);
    expect(plan.pushTitle).toBe(false);
  });

  it("pushes price without sku when only price is LOCAL_ONLY", () => {
    const plan = planShopifyOutboundContentFields({
      title: {
        base: shopifyFieldFingerprint("TITLE", "T"),
        local: "T",
        remote: "T",
        hasLocalSemanticEdit: false,
      },
      description: {
        base: shopifyDescriptionFieldFingerprint("D"),
        local: "D",
        remote: "D",
        hasLocalSemanticEdit: false,
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
        base: shopifyFieldFingerprint("SKU", "SKU-OLD"),
        local: "SKU-OLD",
        remote: "SKU-OLD",
        hasLocalSemanticEdit: true,
      },
    });
    expect(plan.pushPrice).toBe(true);
    expect(plan.pushSku).toBe(false);
    expect(plan.needsVariantMutation).toBe(true);
    expect(plan.variantConflict).toBe(false);
  });
});
