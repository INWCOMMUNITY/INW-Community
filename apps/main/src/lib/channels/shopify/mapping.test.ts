import { describe, expect, it } from "vitest";
import { buildShopifyCreateBody, shopifyProductToSummary } from "./mapping";
import type { SyncStoreItem } from "../types";

function item(overrides: Partial<SyncStoreItem> = {}): SyncStoreItem {
  return {
    id: "item-1",
    sku: null,
    title: "Hat",
    description: null,
    photos: [],
    priceCents: 1000,
    quantity: 2,
    variants: null,
    status: "active",
    condition: "new",
    shippingCostCents: null,
    category: null,
    subcategory: null,
    secondaryCategory: null,
    etsyWhoMade: null,
    etsyWhenMade: null,
    etsyIsSupply: null,
    etsyTaxonomyId: null,
    ebayCategoryId: null,
    ebayConditionEnum: null,
    aspects: null,
    ...overrides,
  };
}

describe("buildShopifyCreateBody sku", () => {
  it("falls back to the item id", () => {
    const body = buildShopifyCreateBody(item()) as { product: { variants?: { sku?: string }[] } };
    expect(body.product.variants?.[0]?.sku).toBe("item-1");
  });

  it("uses the seller SKU when set", () => {
    const body = buildShopifyCreateBody(item({ sku: "HAT-42" })) as {
      product: { variants?: { sku?: string }[] };
    };
    expect(body.product.variants?.[0]?.sku).toBe("HAT-42");
  });
});

describe("shopifyProductToSummary sku", () => {
  it("maps the first variant SKU for inbound attach", () => {
    expect(
      shopifyProductToSummary({
        id: 99,
        title: "Hat",
        variants: [{ sku: "HAT-42", price: "10.00", inventory_quantity: 1 }],
      }).sku
    ).toBe("HAT-42");
  });
});
