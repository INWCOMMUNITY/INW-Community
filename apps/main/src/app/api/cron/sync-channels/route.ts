import { NextRequest, NextResponse } from "next/server";
import { reconcileAllConnections } from "@/lib/channels/reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Optional manual channel reconcile (sales poll, catalog, meta, import).
 * Disabled by default — production uses event-driven sync only (listing save, sale webhooks, Wix webhooks).
 * Set CHANNEL_CRON_SYNC_ENABLED=true in Vercel to run on demand via this route + CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  if (process.env.CHANNEL_CRON_SYNC_ENABLED !== "true") {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason:
        "Channel sync cron is disabled. Inventory updates run on listing save, storefront sale, and webhooks only.",
    });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await reconcileAllConnections();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron] sync-channels failed", { error: String(e) });
    return NextResponse.json({ error: "Reconcile failed" }, { status: 500 });
  }
}
