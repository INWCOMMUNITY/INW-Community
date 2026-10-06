// Wix API endpoints
export const WIX_API_BASE_URL = "https://www.wixapis.com";
export const WIX_OAUTH_AUTHORIZE_URL = "https://www.wix.com/app-installer";
export const WIX_OAUTH_TOKEN_URL = "https://www.wixapis.com/oauth2/token";
export const WIX_CATALOG_VERSION_URL = "/stores/v3/provision/version";

// Timeouts
export const WIX_REQUEST_TIMEOUT_MS = 30_000;
export const WIX_TOKEN_MINT_TIMEOUT_MS = 10_000;

// OAuth state TTL
export const WIX_OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Rate limit defaults
export const WIX_DEFAULT_RATE_LIMIT_WAIT_MS = 1000;
export const WIX_MAX_RATE_LIMIT_WAIT_MS = 30_000;

// Retry limits
export const WIX_MAX_RETRY_ATTEMPTS = 3;
export const WIX_RETRY_BASE_DELAY_MS = 1000;
export const WIX_RETRY_MAX_DELAY_MS = 8000;

// Catalog versions
export const WIX_CATALOG_V1 = "V1_CATALOG";
export const WIX_CATALOG_V3 = "V3_CATALOG";

// API versions by catalog
/** V1 write/create path (stores catalog). */
export const WIX_V1_PRODUCTS = "/stores/v1/products";
/** V1 product query — filter/sort are JSON-encoded strings. Prefer stores-reader. */
export const WIX_V1_PRODUCTS_QUERY = "/stores-reader/v1/products/query";
/** Legacy V1 query path kept for create-listing relative helpers. */
export const WIX_V1_PRODUCT_GET = "/stores/v1/products";
/** Managed variant matrix (Size × Color × Material). Not included on the product GET. */
export const WIX_V1_VARIANTS_QUERY_SUFFIX = "/variants/query";
export const WIX_V1_VARIANTS_UPDATE_SUFFIX = "/variants";
/** Matches the listing editor and Etsy/Shopify. */
export const WIX_MAX_OPTION_AXES = 3;
export const WIX_V2_INVENTORY_ITEMS = "/stores/v2/inventoryItems";
/** Legacy product-scoped path. Catalog V1 writes the inventory item id, with productId in the body. */
export const WIX_V2_INVENTORY_PATCH = "/stores/v2/inventoryItems/product";
export const WIX_V3_PRODUCTS = "/stores/v3/products";
export const WIX_V3_PRODUCTS_QUERY = "/stores/v3/products/query";
export const WIX_V3_INVENTORY = "/stores/v3/inventory-items";

// eCommerce orders API
export const WIX_ECOM_ORDERS_QUERY = "/ecom/v1/orders/query";
export const WIX_ECOM_ORDER_GET = "/ecom/v1/orders";
