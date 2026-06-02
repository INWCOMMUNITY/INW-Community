import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { verifyEtsyWebhook, parseEtsyWebhookEnvelope } from "@/lib/channels/etsy/webhook";
import { reconcileConnectionSales } from "@/lib/channels/reconcile";

export const dynamic = "force-dynamic";

/**
 * POST: Etsy webhook receiver. Low-latency trigger for pooled inventory: verify the signature,
 * resolve the seller's connection from the shop id, and run a targeted reconciliation (Etsy
 * order payloads do not reliably carry listing + quantity, so we re-poll receipts which is the
 * deduped source of truth). Always returns 200 quickly so Etsy does not retry indefinitely.
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
  const { shopId } = parseEtsyWebhookEnvelope(payload);

  // Acknowledge immediately; do the work but never fail the webhook on processing errors.
  try {
    if (shopId) {
      const conn = await prisma.channelConnection.findFirst({
        where: { provider: "etsy", externalShopId: shopId, status: { not: "disconnected" } },
      });
      if (conn) {
        await reconcileConnectionSales(conn);
      }
    }
  } catch (e) {
    console.error("[channels] etsy webhook processing failed", { error: String(e) });
  }

  return NextResponse.json({ ok: true });
}
