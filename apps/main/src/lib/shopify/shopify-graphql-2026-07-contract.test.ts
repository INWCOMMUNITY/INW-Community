import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract guard for Shopify Admin GraphQL API 2026-07.
 * Generic UserError supports field+message only.
 * Specialized *UserError types may expose code.
 * ProductOptionValue.position does not exist; ProductOption.position does.
 */
const shopifyLib = join(__dirname);

function read(rel: string): string {
  return readFileSync(join(shopifyLib, rel), "utf8");
}

describe("Shopify Admin GraphQL 2026-07 selection contracts", () => {
  it("productUpdate content uses generic UserError without code", () => {
    const src = read("update-listing-content.ts");
    const productUpdateBlock = src.match(
      /mutation ShopifyListingContentProductUpdate[\s\S]*?userErrors \{[^}]+\}/
    )?.[0];
    expect(productUpdateBlock).toBeTruthy();
    expect(productUpdateBlock).toContain("userErrors { field message }");
    expect(productUpdateBlock).not.toMatch(/userErrors \{ field message code \}/);
  });

  it("productVariantsBulkUpdate content keeps specialized UserError.code", () => {
    const src = read("update-listing-content.ts");
    const variantBlock = src.match(
      /mutation ShopifyListingContentVariantUpdate[\s\S]*?userErrors \{[^}]+\}/
    )?.[0];
    expect(variantBlock).toBeTruthy();
    expect(variantBlock).toMatch(/userErrors \{ field message code \}/);
  });

  it("topology read keeps ProductOption.position and omits ProductOptionValue.position", () => {
    const src = read("sync-listing-topology.ts");
    const readBlock = src.match(
      /query ShopifyProductTopologyRead[\s\S]*?variants\(first: 100\)/
    )?.[0];
    expect(readBlock).toBeTruthy();
    expect(readBlock).toMatch(/options\s*\{[\s\S]*\bposition\b/);
    expect(readBlock).not.toMatch(/optionValues\s*\{[^}]*\bposition\b/);
    expect(readBlock).toContain("optionValues { id name hasVariants }");
  });

  it("topology / productSet / metafield / inventorySetQuantities use specialized code where valid", () => {
    const topology = read("sync-listing-topology.ts");
    expect(topology).toContain("ShopifyProductOptionsCreate");
    expect(topology).toMatch(
      /mutation ShopifyProductOptionsCreate[\s\S]*?userErrors \{ field message code \}/
    );
    expect(topology).toMatch(
      /mutation ShopifyProductOptionsReorder[\s\S]*?userErrors \{ field message code \}/
    );
    expect(topology).toMatch(
      /mutation ShopifyProductVariantsBulkCreate[\s\S]*?userErrors \{ field message code \}/
    );

    const productSet = read("product-set-listing.ts");
    expect(productSet).toMatch(/userErrors \{ field message code \}/);

    const metafield = read("listing-metafield.ts");
    expect(metafield).toMatch(
      /mutation ShopifyListingExportMetafieldCreate[\s\S]*?userErrors \{ field message code \}/
    );

    const inventory = read("project-inventory.ts");
    expect(inventory).toMatch(
      /mutation ShopifyInventorySetQuantities[\s\S]*?userErrors \{ field message code \}/
    );
    expect(inventory).toMatch(
      /mutation ShopifyInventoryItemEnableTracked[\s\S]*?userErrors \{ field message \}/
    );
    expect(inventory).toMatch(
      /mutation ShopifyInventoryActivate[\s\S]*?userErrors \{ field message \}/
    );
  });

  it("publish/activate/webhook ensures omit generic UserError.code", () => {
    const publish = read("publish-listing.ts");
    expect(publish).toContain("userErrors { field message }");
    expect(publish).not.toMatch(/userErrors \{ field message code \}/);

    const activate = read("activate-listing.ts");
    expect(activate).toContain("userErrors { field message }");
    expect(activate).not.toMatch(/userErrors \{ field message code \}/);
  });
});
