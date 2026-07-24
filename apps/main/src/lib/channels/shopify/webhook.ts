import { createHmac, timingSafeEqual } from "crypto";
import { getShopifyConfig } from "./config";

/**
 * Verify Shopify webhook HMAC (base64) from X-Shopify-Hmac-Sha256.
 * @see https://shopify.dev/docs/apps/build/webhooks/subscribe/https
 */
export function verifyShopifyWebhook(rawBody: string, headers: Headers): boolean {
  const hmac = headers.get("x-shopify-hmac-sha256");
  if (!hmac) return false;
  let secret: string;
  try {
    secret = getShopifyConfig().apiSecret;
  } catch {
    return false;
  }
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  try {
    const a = Buffer.from(digest, "utf8");
    const b = Buffer.from(hmac, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export type ShopifyWebhookTopic =
  | "orders/paid"
  | "inventory_levels/update"
  | "products/update"
  | "products/delete"
  | "unknown";

export function shopifyWebhookTopic(headers: Headers): ShopifyWebhookTopic {
  const topic = (headers.get("x-shopify-topic") ?? "").toLowerCase();
  if (topic === "orders/paid") return "orders/paid";
  if (topic === "inventory_levels/update") return "inventory_levels/update";
  if (topic === "products/update") return "products/update";
  if (topic === "products/delete") return "products/delete";
  return "unknown";
}

export function shopifyWebhookShopDomain(headers: Headers): string | null {
  const shop = headers.get("x-shopify-shop-domain")?.trim().toLowerCase();
  return shop || null;
}
