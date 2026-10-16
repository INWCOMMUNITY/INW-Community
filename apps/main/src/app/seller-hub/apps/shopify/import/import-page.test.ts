import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Shopify import page", () => {
  it("wires discover → review → stock mode → import navigation", () => {
    const source = readFileSync(path.join(__dirname, "page.tsx"), "utf8");
    expect(source).toContain("/api/shopify/import/candidates");
    expect(source).toContain("/api/shopify/import");
    expect(source).toContain('data-testid="shopify-import-candidates"');
    expect(source).toContain('data-testid="shopify-import-review"');
    expect(source).toContain('data-testid="shopify-import-confirm"');
    expect(source).toContain("PHYSICAL");
    expect(source).toContain("MADE_TO_ORDER");
    expect(source).toContain("Import to INW");
    expect(source).toContain("Shipping price on INW");
    expect(source).toContain("shippingCostCents");
    expect(source).not.toContain("Import source not available yet");
  });

  it("wires bulk import progress, ETA, shipping prices, and cancel", () => {
    const source = readFileSync(path.join(__dirname, "page.tsx"), "utf8");
    expect(source).toContain("/api/shopify/import/batch");
    expect(source).toContain("/api/shopify/import/batch/cancel");
    expect(source).toContain('data-testid="shopify-import-set-shipping"');
    expect(source).toContain('data-testid="shopify-import-shipping"');
    expect(source).toContain("Set Shipping Prices");
    expect(source).toContain("Ship for Free with INW (Appreciated)");
    expect(source).toContain("formatEta");
    expect(source).toContain("stockModePolicy");
    expect(source).toContain("shippingPrices");
    expect(source).toContain("RECOMMENDED");
    expect(source).toContain("Cancel import");
    expect(source).toContain('data-testid="shopify-metafield-notice"');
  });
});
