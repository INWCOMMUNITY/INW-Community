import { createHmac, timingSafeEqual } from "crypto";

/** Default replay window for webhook-timestamp (seconds). */
export const ETSY_WEBHOOK_TIMESTAMP_TOLERANCE_SEC = 5 * 60;

/**
 * Derive HMAC key bytes from Etsy webhook signing secret (`whsec_...`).
 * Returns null when the secret is missing or malformed.
 */
export function decodeEtsyWebhookSigningKey(secret: string): Buffer | null {
  const trimmed = secret.trim();
  if (!trimmed) return null;
  const parts = trimmed.split("_", 2);
  const encoded = parts.length === 2 && parts[0] === "whsec" ? parts[1] : trimmed;
  if (!encoded) return null;
  try {
    const key = Buffer.from(encoded, "base64");
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export function buildEtsyWebhookSignedContent(
  webhookId: string,
  webhookTimestamp: string,
  rawBody: string
): string {
  return `${webhookId}.${webhookTimestamp}.${rawBody}`;
}

function collectCandidateSignatures(header: string): string[] {
  const out: string[] = [];
  for (const part of header.split(/[\s,]+/)) {
    const token = part.trim();
    if (!token) continue;
    // Svix-style `v1,<base64>` or bare base64.
    const comma = token.indexOf(",");
    if (comma > 0 && /^v\d+$/i.test(token.slice(0, comma))) {
      out.push(token.slice(comma + 1));
    } else {
      out.push(token);
    }
  }
  return out;
}

function safeEqualBase64(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

/**
 * Verify Etsy webhook signature using raw body + webhook-id + webhook-timestamp.
 * Docs: signed_content = id + "." + timestamp + "." + rawBody;
 * key = base64decode(secret without whsec_ prefix);
 * expected = base64(HMAC-SHA256(key, signed_content)).
 */
export function verifyEtsyWebhookSignature(input: {
  rawBody: string;
  webhookId: string | null;
  webhookTimestamp: string | null;
  webhookSignature: string | null;
  signingSecret: string;
  nowSec?: number;
  toleranceSec?: number;
}): boolean {
  const webhookId = input.webhookId?.trim() ?? "";
  const webhookTimestamp = input.webhookTimestamp?.trim() ?? "";
  const webhookSignature = input.webhookSignature?.trim() ?? "";
  if (!webhookId || !webhookTimestamp || !webhookSignature) return false;

  const ts = Number(webhookTimestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSec ?? ETSY_WEBHOOK_TIMESTAMP_TOLERANCE_SEC;
  if (Math.abs(nowSec - ts) > tolerance) return false;

  const key = decodeEtsyWebhookSigningKey(input.signingSecret);
  if (!key) return false;

  const signedContent = buildEtsyWebhookSignedContent(webhookId, webhookTimestamp, input.rawBody);
  const expected = createHmac("sha256", key).update(signedContent, "utf8").digest("base64");

  for (const candidate of collectCandidateSignatures(webhookSignature)) {
    if (safeEqualBase64(candidate, expected)) return true;
  }
  return false;
}
