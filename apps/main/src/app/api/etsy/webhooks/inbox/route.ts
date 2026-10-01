import { NextRequest, NextResponse } from "next/server";
import {
  EtsyEvidenceIngestError,
  ingestEtsyWebhookEvidence,
  normalizeEtsyWebhookTopic,
  prisma,
} from "database";
import { readEtsyAppConfig } from "@/lib/etsy/config";
import { verifyEtsyWebhookSignature } from "@/lib/etsy/webhook-signature";

export const dynamic = "force-dynamic";

function readWebhookSecret(env: NodeJS.ProcessEnv = process.env): string {
  return env.ETSY_WEBHOOK_SECRET?.trim() ?? "";
}

function parseWebhookBody(rawBody: string): {
  shopId: string | null;
  eventId: string | null;
  eventType: string | null;
} {
  try {
    const parsed = JSON.parse(rawBody) as {
      shop_id?: unknown;
      event_id?: unknown;
      event_type?: unknown;
    };
    const shopId =
      typeof parsed.shop_id === "number" && Number.isFinite(parsed.shop_id)
        ? String(parsed.shop_id)
        : typeof parsed.shop_id === "string" && /^\d+$/.test(parsed.shop_id.trim())
          ? parsed.shop_id.trim()
          : null;
    const eventId = typeof parsed.event_id === "string" ? parsed.event_id.trim() : null;
    const eventType = typeof parsed.event_type === "string" ? parsed.event_type.trim() : null;
    return { shopId, eventId, eventType };
  } catch {
    return { shopId: null, eventId: null, eventType: null };
  }
}

/**
 * Generic Etsy order webhook evidence inbox.
 * Verifies signature, persists evidence, enqueues processing job. No Etsy API calls.
 */
export async function POST(req: NextRequest) {
  const config = readEtsyAppConfig();
  const signingSecret = readWebhookSecret();
  if (!config || !signingSecret) {
    return NextResponse.json({ error: "Etsy webhooks are not configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  const webhookId = req.headers.get("webhook-id");
  const webhookTimestamp = req.headers.get("webhook-timestamp");
  const webhookSignature = req.headers.get("webhook-signature");

  if (
    !verifyEtsyWebhookSignature({
      rawBody,
      webhookId,
      webhookTimestamp,
      webhookSignature,
      signingSecret,
    })
  ) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  if (!webhookId?.trim()) {
    return NextResponse.json({ error: "Missing webhook id" }, { status: 400 });
  }

  const triggeredAtSec = Number(webhookTimestamp);
  if (!Number.isFinite(triggeredAtSec)) {
    return NextResponse.json({ error: "Invalid webhook timestamp" }, { status: 400 });
  }
  const triggeredAt = new Date(triggeredAtSec * 1000);

  const parsed = parseWebhookBody(rawBody);
  const headerTopic = req.headers.get("webhook-topic") ?? req.headers.get("x-etsy-topic");
  const topic = normalizeEtsyWebhookTopic(headerTopic?.trim() || parsed.eventType || "");
  if (!topic) {
    return NextResponse.json({ error: "Missing topic" }, { status: 400 });
  }

  if (!parsed.shopId) {
    return NextResponse.json({ error: "Invalid shop" }, { status: 400 });
  }

  try {
    const result = await ingestEtsyWebhookEvidence(prisma, {
      shopId: parsed.shopId,
      topic,
      webhookId: webhookId.trim(),
      eventId: parsed.eventId,
      triggeredAt,
      rawBody,
    });

    return NextResponse.json({
      ok: true,
      duplicate: result.status === "DUPLICATE",
      evidenceId: result.evidence.id,
      jobId: result.jobId,
    });
  } catch (error) {
    if (error instanceof EtsyEvidenceIngestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
