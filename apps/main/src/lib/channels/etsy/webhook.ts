import { createHmac, timingSafeEqual } from "crypto";
import type { NormalizedInboundEvent } from "../types";
import { getEtsyConfig } from "./config";

/**
 * Verify an Etsy webhook using HMAC-SHA256 of the raw body with the configured secret.
 * If no secret is configured we reject (the reconciliation cron is the reliable fallback,
 * so we never trust an unsigned payload to mutate inventory).
 */
export function verifyEtsyWebhook(rawBody: string, headers: Headers): boolean {
  const secret = getEtsyConfig().webhookSecret;
  if (!secret) return false;
  const provided =
    headers.get("x-etsy-signature") || headers.get("x-etsy-webhook-signature") || "";
  if (!provided) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Pull the shop id + topic out of an Etsy webhook envelope (shapes vary by topic). */
export function parseEtsyWebhookEnvelope(payload: unknown): {
  topic: string | null;
  shopId: string | null;
} {
  if (!payload || typeof payload !== "object") return { topic: null, shopId: null };
  const p = payload as Record<string, unknown>;
  const topic = typeof p.topic === "string" ? p.topic : null;
  const rawShop =
    p.shop_id ??
    (p.data as Record<string, unknown> | undefined)?.shop_id ??
    (p.shop as Record<string, unknown> | undefined)?.shop_id;
  const shopId = rawShop != null ? String(rawShop) : null;
  return { topic, shopId };
}

/**
 * Interface compatibility: Etsy order payloads do not reliably carry listing+quantity,
 * so the webhook route triggers a targeted reconciliation instead of trusting this directly.
 */
export function parseEtsyInboundEvent(payload: unknown, _headers: Headers): NormalizedInboundEvent {
  const { topic } = parseEtsyWebhookEnvelope(payload);
  if (topic && /receipt|order|transaction/i.test(topic)) {
    return { kind: "ignored" };
  }
  return { kind: "ignored" };
}
