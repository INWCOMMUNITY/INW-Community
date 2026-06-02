import { createPublicKey, verify } from "crypto";

type WixWebhookEvent = {
  eventType?: string;
  instanceId?: string;
  data?: string;
};

export type WixWebhookParsed = {
  instanceId: string | null;
  eventType: string | null;
  /** Wix product / catalog item id when present in the payload. */
  productId: string | null;
};

function productIdFromObject(obj: Record<string, unknown>): string | null {
  const direct =
    (typeof obj.productId === "string" && obj.productId) ||
    (typeof obj.entityId === "string" && obj.entityId) ||
    null;
  if (direct) return direct;

  const inv = obj.inventoryItem;
  if (inv && typeof inv === "object" && !Array.isArray(inv)) {
    const pid = (inv as Record<string, unknown>).productId;
    if (typeof pid === "string" && pid) return pid;
  }

  for (const key of ["createdEvent", "updatedEvent", "deletedEvent"] as const) {
    const ev = obj[key];
    if (!ev || typeof ev !== "object" || Array.isArray(ev)) continue;
    const entity = (ev as Record<string, unknown>).entity ?? (ev as Record<string, unknown>).currentEntity;
    if (entity && typeof entity === "object" && !Array.isArray(entity)) {
      const id = (entity as Record<string, unknown>).id;
      if (typeof id === "string" && id) return id;
    }
  }

  return null;
}

function extractProductId(event: WixWebhookEvent, payload: Record<string, unknown>): string | null {
  let id = productIdFromObject(event as unknown as Record<string, unknown>);
  if (id) return id;
  if (typeof event.data === "string") {
    try {
      id = productIdFromObject(JSON.parse(event.data) as Record<string, unknown>);
      if (id) return id;
    } catch {
      /* ignore */
    }
  }
  return productIdFromObject(payload);
}

/**
 * Wix sends the raw body as a JWT signed with the app's webhook public key (RS256).
 * Returns parsed event metadata, or null if verification fails / key not configured.
 */
export function parseWixWebhook(rawBody: string): WixWebhookParsed | null {
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

    const productId = extractProductId(event, payload as Record<string, unknown>);

    return { instanceId, eventType, productId };
  } catch {
    return null;
  }
}

/** Inventory-only webhooks: pull qty without full catalog reconcile. */
export function wixWebhookIsInventoryEvent(eventType: string | null): boolean {
  if (!eventType) return false;
  const t = eventType.toLowerCase();
  return /inventory|stock|tracking/.test(t);
}

/** Product create/delete and orders need full reconcile. */
export function wixWebhookTriggersFullReconcile(eventType: string | null): boolean {
  if (!eventType) return true;
  if (wixWebhookIsInventoryEvent(eventType)) return false;
  const t = eventType.toLowerCase();
  if (/order|product|catalog|stores|variant/i.test(t)) return true;
  if (/wix\.stores|wix\.ecom|wix\.ecommerce/i.test(t)) return true;
  return false;
}

/** @deprecated Use wixWebhookTriggersFullReconcile */
export function wixWebhookTriggersReconcile(eventType: string | null): boolean {
  return wixWebhookTriggersFullReconcile(eventType) || wixWebhookIsInventoryEvent(eventType);
}
