export const SHOPIFY_PRODUCT_GID_PATTERN = /^gid:\/\/shopify\/Product\/\d+$/;
export const SHOPIFY_PRODUCT_VARIANT_GID_PATTERN = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
export const SHOPIFY_INVENTORY_ITEM_GID_PATTERN = /^gid:\/\/shopify\/InventoryItem\/\d+$/;
export const SHOPIFY_ORDER_GID_PATTERN = /^gid:\/\/shopify\/Order\/\d+$/;
export const SHOPIFY_LINE_ITEM_GID_PATTERN = /^gid:\/\/shopify\/LineItem\/\d+$/;

export type ShopifyGidResource =
  | "Product"
  | "ProductVariant"
  | "InventoryItem"
  | "Order"
  | "LineItem";

export function isShopifyProductGid(value: string): boolean {
  return SHOPIFY_PRODUCT_GID_PATTERN.test(value);
}

export function isShopifyProductVariantGid(value: string): boolean {
  return SHOPIFY_PRODUCT_VARIANT_GID_PATTERN.test(value);
}

export function isShopifyInventoryItemGid(value: string): boolean {
  return SHOPIFY_INVENTORY_ITEM_GID_PATTERN.test(value);
}

export function isShopifyOrderGid(value: string): boolean {
  return SHOPIFY_ORDER_GID_PATTERN.test(value);
}

export function isShopifyLineItemGid(value: string): boolean {
  return SHOPIFY_LINE_ITEM_GID_PATTERN.test(value);
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

export function assertShopifyOrderGid(value: string): string {
  if (!isShopifyOrderGid(value)) {
    throw new ShopifyGidValidationError("Order", value);
  }
  return value;
}

export function assertShopifyLineItemGid(value: string): string {
  if (!isShopifyLineItemGid(value)) {
    throw new ShopifyGidValidationError("LineItem", value);
  }
  return value;
}

export function shopifyProductVariantGidFromNumericId(id: number | string): string {
  const n = typeof id === "number" ? id : Number(String(id).trim());
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new ShopifyGidValidationError("ProductVariant", String(id));
  }
  return assertShopifyProductVariantGid(`gid://shopify/ProductVariant/${n}`);
}

export function shopifyOrderGidFromNumericId(id: number | string): string {
  const n = typeof id === "number" ? id : Number(String(id).trim());
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new ShopifyGidValidationError("Order", String(id));
  }
  return assertShopifyOrderGid(`gid://shopify/Order/${n}`);
}

export function shopifyLineItemGidFromNumericId(id: number | string): string {
  const n = typeof id === "number" ? id : Number(String(id).trim());
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new ShopifyGidValidationError("LineItem", String(id));
  }
  return assertShopifyLineItemGid(`gid://shopify/LineItem/${n}`);
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
