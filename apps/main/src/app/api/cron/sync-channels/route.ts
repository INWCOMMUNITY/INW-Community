import { NextRequest, NextResponse } from "next/server";
import { reconcileAllConnections } from "@/lib/channels/reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reconciliation cron: polls every active channel connection for recent sales (catching anything
 * a webhook missed) and re-pushes current quantities. Auth via CRON_SECRET (same as other crons).
 */
export async function GET(req: NextRequest) {
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
