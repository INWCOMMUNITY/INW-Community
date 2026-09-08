/** Shopify Partner App credentials + Admin API version. */

export const SHOPIFY_DEFAULT_API_VERSION = "2024-10";

/** Scopes for two-way product/inventory sync + order reconciliation. */
export const SHOPIFY_SCOPES = [
  "read_products",
  "write_products",
  "read_inventory",
  "write_inventory",
  "read_orders",
];

export type ShopifyAppConfig = {
  apiKey: string;
  apiSecret: string;
  apiVersion: string;
  /** Optional inventory location override for multi-location shops. */
  defaultLocationId: string | null;
};

export function getShopifyConfig(): ShopifyAppConfig {
  const apiKey = process.env.SHOPIFY_API_KEY?.trim() || "";
  const apiSecret = process.env.SHOPIFY_API_SECRET?.trim() || "";
  if (!apiKey || !apiSecret) {
    throw new Error("Shopify is not configured: set SHOPIFY_API_KEY and SHOPIFY_API_SECRET.");
  }
  return {
    apiKey,
    apiSecret,
    apiVersion: process.env.SHOPIFY_API_VERSION?.trim() || SHOPIFY_DEFAULT_API_VERSION,
    defaultLocationId: process.env.SHOPIFY_DEFAULT_LOCATION_ID?.trim() || null,
  };
}

export function isShopifyConfigured(): boolean {
  try {
    getShopifyConfig();
    return true;
  } catch {
    return false;
  }
}

/** Shopify store slug: letters, numbers, hyphen, underscore. */
const SHOP_SLUG = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Normalize seller input or a Shopify callback `shop` to `{slug}.myshopify.com`.
 * Accepts store slug, `*.myshopify.com`, or Admin URLs like `admin.shopify.com/store/{slug}`.
 * Returns null if the value cannot be parsed safely.
 */
export function normalizeShopDomain(input: string): string | null {
  let raw = input.trim().toLowerCase();
  if (!raw) return null;

  const adminStore = raw.match(
    /(?:^https?:\/\/)?(?:www\.)?(?:admin\.)?shopify\.com\/store\/([a-z0-9][a-z0-9_-]*)/i
  );
  if (adminStore?.[1] && SHOP_SLUG.test(adminStore[1].toLowerCase())) {
    return `${adminStore[1].toLowerCase()}.myshopify.com`;
  }

  raw = raw.replace(/^https?:\/\//, "");
  raw = raw.split("/")[0] ?? "";
  raw = raw.replace(/\.+$/, "");
  if (raw.startsWith("www.")) raw = raw.slice(4);
  if (!raw) return null;
  if (raw.endsWith(".myshopify.com")) {
    const slug = raw.slice(0, -".myshopify.com".length);
    if (!SHOP_SLUG.test(slug)) return null;
    return `${slug}.myshopify.com`;
  }
  if (!SHOP_SLUG.test(raw)) return null;
  return `${raw}.myshopify.com`;
}

/**
 * Shopify OAuth `host` is base64 of `admin.shopify.com/store/{slug}` (or similar).
 * Used when the `shop` query param is missing or not a myshopify domain.
 */
export function shopDomainFromHostParam(host: string | null | undefined): string | null {
  if (!host?.trim()) return null;
  try {
    const decoded = Buffer.from(host.trim(), "base64").toString("utf8").trim();
    if (!decoded) return null;
    return normalizeShopDomain(decoded);
  } catch {
    return null;
  }
}

export function shopAdminBase(shop: string, apiVersion: string): string {
  return `https://${shop}/admin/api/${apiVersion}`;
}

export type ShopifyConnectionConfig = {
  shop: string;
  locationId: string | null;
  apiVersion: string;
};

export function readShopifyConfig(
  config: Record<string, unknown> | null,
  externalShopId: string | null
): ShopifyConnectionConfig {
  const shop =
    (typeof config?.shop === "string" && config.shop) ||
    externalShopId ||
    "";
  const locationId =
    typeof config?.locationId === "string" ? config.locationId : null;
  const apiVersion =
    typeof config?.apiVersion === "string" ? config.apiVersion : SHOPIFY_DEFAULT_API_VERSION;
  return { shop, locationId, apiVersion };
}
