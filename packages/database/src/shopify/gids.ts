export const SHOPIFY_PRODUCT_GID_PATTERN = /^gid:\/\/shopify\/Product\/\d+$/;
export const SHOPIFY_PRODUCT_VARIANT_GID_PATTERN = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
export const SHOPIFY_INVENTORY_ITEM_GID_PATTERN = /^gid:\/\/shopify\/InventoryItem\/\d+$/;

export type ShopifyGidResource = "Product" | "ProductVariant" | "InventoryItem";

export function isShopifyProductGid(value: string): boolean {
  return SHOPIFY_PRODUCT_GID_PATTERN.test(value);
}

export function isShopifyProductVariantGid(value: string): boolean {
  return SHOPIFY_PRODUCT_VARIANT_GID_PATTERN.test(value);
}

export function isShopifyInventoryItemGid(value: string): boolean {
  return SHOPIFY_INVENTORY_ITEM_GID_PATTERN.test(value);
}

export function assertShopifyProductGid(value: string): string {
  if (!isShopifyProductGid(value)) {
    throw new ShopifyGidValidationError("Product", value);
  }
  return value;
}

export function assertShopifyProductVariantGid(value: string): string {
  if (!isShopifyProductVariantGid(value)) {
    throw new ShopifyGidValidationError("ProductVariant", value);
  }
  return value;
}

export function assertShopifyInventoryItemGid(value: string): string {
  if (!isShopifyInventoryItemGid(value)) {
    throw new ShopifyGidValidationError("InventoryItem", value);
  }
  return value;
}

export class ShopifyGidValidationError extends Error {
  readonly code = "INVALID_SHOPIFY_GID" as const;
  readonly resource: ShopifyGidResource;

  constructor(resource: ShopifyGidResource, value: string) {
    super(`Invalid Shopify ${resource} GID`);
    this.name = "ShopifyGidValidationError";
    this.resource = resource;
    void value;
  }
}
