import { NextRequest, NextResponse } from "next/server";
import { reconcileConnectionFull } from "@/lib/channels/reconcile-connection";
import { findWixConnectionByInstanceId } from "@/lib/channels/wix/site";
import { parseWixWebhook, wixWebhookTriggersReconcile } from "@/lib/channels/wix/webhook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Wix webhook receiver (JWT body). Triggers sales + catalog + import reconcile for the site.
 * Configure callback URL in Wix Dev Center → Webhooks and set WIX_WEBHOOK_PUBLIC_KEY on Vercel.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const parsed = parseWixWebhook(rawBody);

  if (!parsed && process.env.WIX_WEBHOOK_PUBLIC_KEY?.trim()) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const instanceId = parsed?.instanceId;
  if (!instanceId) {
    return NextResponse.json({ ok: true, skipped: "no_instance" });
  }

  if (!wixWebhookTriggersReconcile(parsed?.eventType ?? null)) {
    return NextResponse.json({ ok: true, skipped: "event_type" });
  }

  try {
    const conn = await findWixConnectionByInstanceId(instanceId);
    if (!conn) {
      return NextResponse.json({ ok: true, skipped: "unknown_instance" });
    }
    const result = await reconcileConnectionFull(conn);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[channels] wix webhook failed", { error: String(e) });
    return NextResponse.json({ ok: true });
  }
}
