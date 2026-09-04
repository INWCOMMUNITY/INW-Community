import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { tryAcquireCronLock, releaseCronLock } from "@/lib/cron-job-lock";
import { getSellerShippoCredential } from "@/lib/shippo-seller";
import { fetchShippoTracking, fetchShippoTransaction } from "@/lib/shippo-transaction";
import { persistShipmentTrackingStatus } from "@/lib/shippo-tracking-persist";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;
const LOCK_TTL_MS = 80_000;
const BATCH = 40;

/**
 * GET/POST /api/cron/reconcile-shipments
 * Poll Shippo for paid/shipped labels and persist trackingStatus so DELIVERED can complete the ship leg.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lock = await tryAcquireCronLock("reconcile-shipments", LOCK_TTL_MS);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: "lease_held" });
  }

  const started = Date.now();
  let checked = 0;
  let updated = 0;
  let delivered = 0;

  try {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const shipments = await prisma.shipment.findMany({
      where: {
        shippoTransactionId: { not: null },
        createdAt: { gte: since },
        order: { status: { in: ["paid", "shipped"] } },
        OR: [{ trackingStatus: null }, { trackingStatus: { not: "DELIVERED" } }],
      },
      select: {
        id: true,
        carrier: true,
        trackingNumber: true,
        shippoTransactionId: true,
        order: { select: { sellerId: true } },
      },
      take: BATCH,
      orderBy: { createdAt: "asc" },
    });

    for (const shipment of shipments) {
      checked += 1;
      const cred = await getSellerShippoCredential(shipment.order.sellerId);
      if (!cred) continue;

      let trackingNumber = shipment.trackingNumber;
      const txId = shipment.shippoTransactionId?.trim() || null;
      if (txId) {
        const tx = await fetchShippoTransaction(cred, txId);
        if (tx?.trackingNumber) trackingNumber = tx.trackingNumber;
      }
      if (!trackingNumber) continue;

      const track = await fetchShippoTracking(cred, shipment.carrier, trackingNumber);
      if (!track?.trackingStatus) continue;

      const result = await persistShipmentTrackingStatus({
        shipmentId: shipment.id,
        trackingStatus: track.trackingStatus,
      });
      if (result.updated) updated += 1;
      if (result.delivered) delivered += 1;
    }

    console.log("[cron/reconcile-shipments]", { checked, updated, delivered, durationMs: Date.now() - started });
    return NextResponse.json({ ok: true, checked, updated, delivered });
  } catch (e) {
    console.error("[cron/reconcile-shipments] error:", e);
    return NextResponse.json({ error: "Reconcile failed" }, { status: 500 });
  } finally {
    await releaseCronLock("reconcile-shipments", lock.holderId, { durationMs: Date.now() - started });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
