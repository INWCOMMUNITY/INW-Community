import { createHash, createVerify } from "crypto";

/**
 * Wix delivers webhooks as an RS256 JWT in the raw body.
 * The public key comes from the app dashboard (`WIX_WEBHOOK_PUBLIC_KEY`).
 */
export type WixWebhookEvent = Record<string, unknown>;

export type WixWebhookVerifyResult =
  | {
      valid: true;
      instanceId: string;
      siteId: string | null;
      webhookId: string;
      eventId: string | null;
      topic: string;
      triggeredAt: Date;
      event: WixWebhookEvent;
    }
  | { valid: false; error: string };

export function verifyWixWebhook(input: {
  rawBody: string;
  publicKey: string | null;
  allowUnsigned?: boolean;
  now?: Date;
}): WixWebhookVerifyResult {
  const rawBody = input.rawBody.trim();
  if (!rawBody) {
    return { valid: false, error: "Empty webhook body" };
  }

  if (!input.publicKey) {
    if (input.allowUnsigned) {
      return acceptUnsignedWebhook(rawBody, input.now ?? new Date());
    }
    return { valid: false, error: "Webhook public key is not configured" };
  }

  const payload = verifyWixWebhookJwt(rawBody, input.publicKey);
  if (!payload) {
    return { valid: false, error: "Invalid webhook signature" };
  }

  const decoded = decodeWixWebhookPayload(payload, rawBody, input.now ?? new Date());
  if (!decoded) {
    return { valid: false, error: "Webhook payload was missing instance or event type" };
  }
  return decoded;
}

function acceptUnsignedWebhook(rawBody: string, now: Date): WixWebhookVerifyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return { valid: false, error: "Unsigned webhook body was not JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { valid: false, error: "Unsigned webhook body was not an object" };
  }
  return (
    decodeWixWebhookPayload(parsed as Record<string, unknown>, rawBody, now) ?? {
      valid: false,
      error: "Webhook payload was missing instance or event type",
    }
  );
}

export function verifyWixWebhookJwt(
  token: string,
  publicKey: string
): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) return null;

  let header: { alg?: string };
  try {
    header = JSON.parse(decodeBase64Url(headerPart)) as { alg?: string };
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;

  const signature = Buffer.from(signaturePart, "base64url");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerPart}.${payloadPart}`);
  verifier.end();
  let verified = false;
  try {
    verified = verifier.verify(normalizePublicKey(publicKey), signature);
  } catch {
    return null;
  }
  if (!verified) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(payloadPart)) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function decodeWixWebhookPayload(
  payload: Record<string, unknown>,
  rawBody: string,
  now: Date
): Extract<WixWebhookVerifyResult, { valid: true }> | null {
  const inner = unwrapData(payload.data) ?? payload;
  const instanceId = readString(inner.instanceId) ?? readString(payload.instanceId);
  const topic =
    readString(inner.eventType) ??
    readString(payload.eventType) ??
    readString(inner.topic) ??
    readString(payload.topic);
  if (!instanceId || !topic) return null;

  const event = unwrapData(inner.data) ?? inner;
  const siteId = readString(event.siteId) ?? readString(inner.siteId) ?? readString(payload.siteId);
  const eventId =
    readString(event.id) ??
    readString(event.eventId) ??
    readString(inner.eventId) ??
    readString(payload.eventId);
  const triggeredAt = readEventTime(payload, inner, event) ?? now;

  return {
    valid: true,
    instanceId,
    siteId,
    webhookId: hashWixWebhookBody(rawBody),
    eventId,
    topic,
    triggeredAt,
    event,
  };
}

export function hashWixWebhookBody(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

function unwrapData(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return unwrapData(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readEventTime(
  payload: Record<string, unknown>,
  inner: Record<string, unknown>,
  event: Record<string, unknown>
): Date | null {
  const candidates = [event.eventTime, event.triggeredAt, inner.eventTime, payload.iat];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      const ms = candidate > 10_000_000_000 ? candidate : candidate * 1000;
      return new Date(ms);
    }
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = new Date(candidate);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return null;
}

function decodeBase64Url(segment: string): string {
  return Buffer.from(segment, "base64url").toString("utf8");
}

function normalizePublicKey(key: string): string {
  const trimmed = key.replace(/\\n/g, "\n").trim();
  if (trimmed.includes("BEGIN")) return trimmed;
  const body = trimmed.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}
