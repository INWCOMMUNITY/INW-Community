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
    expect(source).not.toContain("Import source not available yet");
  });
});
