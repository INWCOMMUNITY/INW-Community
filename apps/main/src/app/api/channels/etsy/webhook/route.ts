import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { verifyEtsyWebhook, parseEtsyWebhookEnvelope } from "@/lib/channels/etsy/webhook";
import { reconcileConnectionSales } from "@/lib/channels/reconcile";
import { reconcileConnectionInboundCatalog } from "@/lib/channels/reconcile-inbound-catalog";
import {
  logWebhookEvent,
  markWebhookProcessing,
  markWebhookCompleted,
  markWebhookFailed,
} from "@/lib/channels/webhook-event";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST: Etsy webhook receiver. Low-latency trigger for pooled inventory: verify the signature,
 * resolve the seller's connection from the shop id, and run a targeted reconciliation (Etsy
 * order payloads do not reliably carry listing + quantity, so we re-poll receipts which is the
 * deduped source of truth). Also kicks baseline catalog reconcile so content/qty drift heals.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!verifyEtsyWebhook(rawBody, req.headers)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    payload = null;
  }
  const { shopId, topic } = parseEtsyWebhookEnvelope(payload);

  const webhookEventId = await logWebhookEvent(
    "etsy",
    topic ?? "unknown",
    payload,
    shopId ?? undefined
  );

  try {
    await markWebhookProcessing(webhookEventId);

    if (shopId) {
      const conn = await prisma.channelConnection.findFirst({
        where: { provider: "etsy", externalShopId: shopId, status: { not: "disconnected" } },
      });
      if (conn) {
        await reconcileConnectionSales(conn);
        await reconcileConnectionInboundCatalog(conn).catch((e) =>
          console.error("[channels] etsy webhook catalog reconcile failed", {
            error: String(e),
          })
        );
      }
    }

    await markWebhookCompleted(webhookEventId);
    return NextResponse.json({ ok: true, processed: true });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error("[channels] etsy webhook processing failed", { error: errorMsg });
    await markWebhookFailed(webhookEventId, errorMsg);
    return NextResponse.json({ ok: false, error: "Webhook processing failed" }, { status: 500 });
  }
}
