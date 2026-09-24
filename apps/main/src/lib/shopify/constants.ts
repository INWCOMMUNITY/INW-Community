/** Latest stable Admin API version as of 2026-09-24. Release candidate 2026-10 is not used. */
export const SHOPIFY_ADMIN_API_VERSION = "2026-07";

/**
 * Least privilege for the planned V2 flow.
 * `read_all_orders`, customer, and payment scopes are intentionally omitted.
 * Shopify treats a granted `write_*` scope as satisfying the matching `read_*`.
 */
export const SHOPIFY_OAUTH_SCOPES = [
  "read_products",
  "write_products",
  "read_inventory",
  "write_inventory",
  "read_orders",
  "read_locations",
] as const;

export const SHOPIFY_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export const SHOPIFY_SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export const SHOPIFY_LOCATION_GID_PATTERN = /^gid:\/\/shopify\/Location\/\d+$/;

export const SHOPIFY_SHOP_GID_PATTERN = /^gid:\/\/shopify\/Shop\/\d+$/;

export const SHOPIFY_PRODUCT_GID_PATTERN = /^gid:\/\/shopify\/Product\/\d+$/;

export const SHOPIFY_PRODUCT_VARIANT_GID_PATTERN = /^gid:\/\/shopify\/ProductVariant\/\d+$/;

export const SHOPIFY_INVENTORY_ITEM_GID_PATTERN = /^gid:\/\/shopify\/InventoryItem\/\d+$/;

export const SHOPIFY_SELLER_RETURN_PATH = "/seller-hub/shopify";
