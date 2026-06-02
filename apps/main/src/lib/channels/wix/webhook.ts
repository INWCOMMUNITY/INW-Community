import { createPublicKey, verify } from "crypto";

type WixWebhookEvent = {
  eventType?: string;
  instanceId?: string;
  data?: string;
};

/**
 * Wix sends the raw body as a JWT signed with the app's webhook public key (RS256).
 * Returns parsed event metadata, or null if verification fails / key not configured.
 */
export function parseWixWebhook(
  rawBody: string
): { instanceId: string | null; eventType: string | null } | null {
  const pem = process.env.WIX_WEBHOOK_PUBLIC_KEY?.trim();
  if (!pem) return null;

  const parts = rawBody.trim().split(".");
  if (parts.length !== 3) return null;

  try {
    const key = createPublicKey(pem.replace(/\\n/g, "\n"));
    const signingInput = `${parts[0]}.${parts[1]}`;
    const signature = Buffer.from(parts[2], "base64url");
    const valid = verify("RSA-SHA256", Buffer.from(signingInput), key, signature);
    if (!valid) return null;

    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as { data?: string };

    let event: WixWebhookEvent = {};
    if (typeof payload.data === "string") {
      try {
        event = JSON.parse(payload.data) as WixWebhookEvent;
      } catch {
        event = {};
      }
    }

    let eventType = event.eventType ?? null;
    let instanceId = event.instanceId ?? null;

    if (typeof event.data === "string") {
      try {
        const inner = JSON.parse(event.data) as Record<string, unknown>;
        if (!eventType && typeof inner.eventType === "string") eventType = inner.eventType;
        if (!instanceId && typeof inner.instanceId === "string") instanceId = inner.instanceId;
      } catch {
        /* ignore */
      }
    }

    return { instanceId, eventType };
  } catch {
    return null;
  }
}

/** Event types that should trigger a full inventory + catalog reconcile. */
export function wixWebhookTriggersReconcile(eventType: string | null): boolean {
  if (!eventType) return true;
  return /order|product|inventory|catalog|stores/i.test(eventType);
}
