import { NextRequest, NextResponse } from "next/server";
import { persistShipmentTrackingStatus } from "@/lib/shippo-tracking-persist";

export const dynamic = "force-dynamic";

function webhookToken(req: NextRequest): string | null {
  const q = req.nextUrl.searchParams.get("token")?.trim();
  if (q) return q;
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.headers.get("x-shippo-token")?.trim() || null;
}

/**
 * POST /api/shipping/shippo-webhook
 * Optional Shippo track webhook. Requires SHIPPO_WEBHOOK_TOKEN.
 * Does not trust client URLs — only persists status onto shipments we already stored.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.SHIPPO_WEBHOOK_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json({ error: "Shippo webhook is not configured" }, { status: 503 });
  }
  const provided = webhookToken(req);
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const root = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const data =
    root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : root;
  const trackingNumber =
    (typeof data.tracking_number === "string" && data.tracking_number.trim()) ||
    (typeof root.tracking_number === "string" && root.tracking_number.trim()) ||
    null;
  const txIdRaw = data.transaction ?? data.object_id ?? root.transaction;
  const shippoTransactionId = typeof txIdRaw === "string" ? txIdRaw.trim() : null;
  const statusObj =
    data.tracking_status && typeof data.tracking_status === "object"
      ? (data.tracking_status as Record<string, unknown>)
      : null;
  const trackingStatus =
    (typeof statusObj?.status === "string" && statusObj.status) ||
    (typeof data.status === "string" && data.status) ||
    "";

  if (!trackingStatus || (!trackingNumber && !shippoTransactionId)) {
    return NextResponse.json({ ok: true, skipped: "no_tracking" });
  }

  const result = await persistShipmentTrackingStatus({
    trackingNumber,
    shippoTransactionId,
    trackingStatus,
  });
  return NextResponse.json({ ok: true, ...result });
}
