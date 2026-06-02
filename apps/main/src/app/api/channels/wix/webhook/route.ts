import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { pullWixInventoryForConnection } from "@/lib/channels/pull-wix-inventory";
import { reconcileConnectionFull } from "@/lib/channels/reconcile-connection";
import { findWixConnectionByInstanceId } from "@/lib/channels/wix/site";
import {
  parseWixWebhook,
  wixWebhookIsInventoryEvent,
  wixWebhookTriggersFullReconcile,
} from "@/lib/channels/wix/webhook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Wix webhook receiver (JWT body). Triggers sales + catalog + import reconcile for the site.
 * Configure callback URL in Wix Dev Center → Webhooks and set WIX_WEBHOOK_PUBLIC_KEY on Vercel.
 */
export async function POST(req: NextRequest) {
  if (!process.env.WIX_WEBHOOK_PUBLIC_KEY?.trim()) {
    console.warn("[channels] wix webhook: WIX_WEBHOOK_PUBLIC_KEY not set — cannot verify or process");
    return NextResponse.json(
      { error: "Wix webhooks not configured (missing WIX_WEBHOOK_PUBLIC_KEY)" },
      { status: 503 }
    );
  }

  const rawBody = await req.text();
  const parsed = parseWixWebhook(rawBody);

  if (!parsed) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const instanceId = parsed.instanceId;
  const eventType = parsed.eventType ?? null;
  const productId = parsed.productId;

  if (!instanceId) {
    return NextResponse.json({ ok: true, skipped: "no_instance" });
  }

  const isInventory = wixWebhookIsInventoryEvent(eventType);
  const isFull = wixWebhookTriggersFullReconcile(eventType);

  if (!isInventory && !isFull) {
    return NextResponse.json({ ok: true, skipped: "event_type", eventType });
  }

  try {
    const conn = await findWixConnectionByInstanceId(instanceId);
    if (!conn) {
      return NextResponse.json({ ok: true, skipped: "unknown_instance" });
    }

    const run = async () => {
      if (isInventory) {
        await pullWixInventoryForConnection(conn, productId ? [productId] : undefined);
        return;
      }
      await reconcileConnectionFull(conn);
    };

    const work = run().catch((e) => {
      console.error("[channels] wix webhook reconcile failed", {
        connectionId: conn.id,
        eventType,
        productId,
        error: String(e),
      });
    });

    if (process.env.VERCEL) {
      waitUntil(work);
      return NextResponse.json({
        ok: true,
        queued: true,
        eventType,
        mode: isInventory ? "inventory" : "full",
      });
    }

    await work;
    return NextResponse.json({ ok: true, eventType, mode: isInventory ? "inventory" : "full" });
  } catch (e) {
    console.error("[channels] wix webhook failed", { error: String(e) });
    return NextResponse.json({ ok: true });
  }
}
