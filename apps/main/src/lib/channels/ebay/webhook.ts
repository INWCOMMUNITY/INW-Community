import { createHash, timingSafeEqual } from "crypto";

const WEBHOOK_PATH = "/api/channels/ebay/webhook";

function ebayWebhookSecret(): string | null {
  const secret = process.env.EBAY_WEBHOOK_SECRET?.trim();
  return secret || null;
}

/**
 * Delivery URL registered with eBay Platform Notifications / Commerce Notifications.
 * Includes `?secret=` when `EBAY_WEBHOOK_SECRET` is set so POSTs pass `verifyEbayWebhook`.
 */
export function buildEbayWebhookUrl(baseUrl: string): string {
  const origin = baseUrl.replace(/\/+$/, "");
  const url = new URL(WEBHOOK_PATH, `${origin}/`);
  const secret = ebayWebhookSecret();
  if (secret) url.searchParams.set("secret", secret);
  return url.toString();
}

/** True when the stored ApplicationURL already carries the current webhook secret. */
export function ebayWebhookUrlIsSecured(url: string | null | undefined): boolean {
  const secret = ebayWebhookSecret();
  if (!secret || !url) return false;
  try {
    return new URL(url).searchParams.get("secret") === secret;
  } catch {
    return false;
  }
}

export function redactEbayWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("secret")) parsed.searchParams.set("secret", "***");
    return parsed.toString();
  } catch {
    return url.replace(/([?&]secret=)[^&]*/gi, "$1***");
  }
}

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
  const secret = ebayWebhookSecret();
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

/**
 * eBay Platform Notifications often POST to ApplicationURL with the query string
 * stripped, so `?secret=` never arrives. A parseable envelope with an item or
 * seller id is enough to continue; we still GetItem with our own token.
 */
export function ebayWebhookEnvelopeIsTrusted(parsed: {
  parseable: boolean;
  itemId: string | null;
  ebayUserId: string | null;
}): boolean {
  return parsed.parseable && Boolean(parsed.itemId || parsed.ebayUserId);
}

/** Same token we send when creating a Commerce Notification destination. */
export function ebayNotificationVerificationToken(): string | null {
  const dedicated = process.env.EBAY_NOTIFICATION_VERIFICATION_TOKEN?.trim();
  if (dedicated) return dedicated;
  return ebayWebhookSecret();
}

/**
 * eBay Commerce destination challenge: SHA-256 hex of
 * challengeCode + verificationToken + endpoint (that order, exact registered URL).
 */
export function ebayCommerceChallengeResponse(
  challengeCode: string,
  verificationToken: string,
  endpoint: string
): string {
  return createHash("sha256")
    .update(challengeCode)
    .update(verificationToken)
    .update(endpoint)
    .digest("hex");
}
