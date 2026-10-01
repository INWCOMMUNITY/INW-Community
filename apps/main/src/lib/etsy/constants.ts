/**
 * Least privilege for Etsy Marketplace V2 E1+ listing/order sync.
 * listings_d is deferred until delete/end flows ship.
 */
export const ETSY_OAUTH_SCOPES = [
  "listings_r",
  "listings_w",
  "shops_r",
  "transactions_r",
] as const;

export const ETSY_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Etsy refresh tokens last ~90 days per Open API auth docs. */
export const ETSY_REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const ETSY_OAUTH_CONNECT_URL = "https://www.etsy.com/oauth/connect";

export const ETSY_OAUTH_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";

export const ETSY_API_BASE_URL = "https://api.etsy.com/v3/application";

/** OAuth return lands on Apps Airport Etsy connection settings. */
export const ETSY_SELLER_RETURN_PATH = "/seller-hub/apps/etsy/settings";
