import { timingSafeEqual } from "crypto";

/**
 * Verify an eBay Platform Notification webhook using a shared secret passed as a
 * query parameter on the registered webhook URL.
 *
 * eBay Platform Notifications do not provide HMAC signatures on POST payloads.
 * The recommended approach is to register the webhook URL with a secret query param
 * (e.g. `/api/channels/ebay/webhook?secret=XXX`) and validate it server-side.
 *
 * Returns false (reject) when EBAY_WEBHOOK_SECRET is not configured — forces
 * explicit opt-in, same pattern as Etsy/Shopify/Wix.
 */
export function verifyEbayWebhook(req: { nextUrl: { searchParams: { get(k: string): string | null } } }): boolean {
  const secret = process.env.EBAY_WEBHOOK_SECRET?.trim();
  if (!secret) return false;

  const provided = req.nextUrl.searchParams.get("secret") ?? "";
  if (!provided) return false;

  try {
    const a = Buffer.from(secret, "utf8");
    const b = Buffer.from(provided, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
