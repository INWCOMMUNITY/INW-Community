import { describe, expect, it } from "vitest";
import {
  assertShopifyInventoryItemGid,
  assertShopifyProductGid,
  assertShopifyProductVariantGid,
  isShopifyInventoryItemGid,
  isShopifyProductGid,
  isShopifyProductVariantGid,
  ShopifyGidValidationError,
} from "database";
import {
  SHOPIFY_INVENTORY_ITEM_GID_PATTERN,
  SHOPIFY_PRODUCT_GID_PATTERN,
  SHOPIFY_PRODUCT_VARIANT_GID_PATTERN,
} from "./constants";

describe("shopify mapping GID constants", () => {
  it("keeps apps/main patterns aligned with database validators", () => {
    expect(SHOPIFY_PRODUCT_GID_PATTERN.test("gid://shopify/Product/1")).toBe(true);
    expect(SHOPIFY_PRODUCT_VARIANT_GID_PATTERN.test("gid://shopify/ProductVariant/2")).toBe(true);
    expect(SHOPIFY_INVENTORY_ITEM_GID_PATTERN.test("gid://shopify/InventoryItem/3")).toBe(true);
    expect(isShopifyProductGid("gid://shopify/Product/1")).toBe(true);
    expect(isShopifyProductVariantGid("gid://shopify/ProductVariant/2")).toBe(true);
    expect(isShopifyInventoryItemGid("gid://shopify/InventoryItem/3")).toBe(true);
    expect(isShopifyProductGid("gid://shopify/ProductVariant/1")).toBe(false);
    expect(() => assertShopifyProductGid("gid://shopify/ProductVariant/1")).toThrow(
      ShopifyGidValidationError
    );
    expect(() => assertShopifyProductVariantGid("gid://shopify/Product/1")).toThrow(
      ShopifyGidValidationError
    );
    expect(() => assertShopifyInventoryItemGid("not-a-gid")).toThrow(ShopifyGidValidationError);
  });
});
