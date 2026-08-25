import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getSellerShippoCredential } from "@/lib/shippo-seller";
import { fetchShippoTracking } from "@/lib/shippo-transaction";
import { persistShipmentTrackingStatus } from "@/lib/shippo-tracking-persist";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const trackingNumber = searchParams.get("tracking");
  const shipmentId = searchParams.get("shipmentId");

  if (!trackingNumber && !shipmentId) {
    return NextResponse.json({ error: "Provide tracking or shipmentId" }, { status: 400 });
  }

  let code: string | null = trackingNumber;
  let carrier = "usps";
  if (shipmentId) {
    const shipment = await prisma.shipment.findFirst({
      where: { id: shipmentId },
      include: {
        order: { select: { sellerId: true } },
      },
    });
    if (!shipment || shipment.order.sellerId !== session.user.id) {
      return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    }
    code = shipment.trackingNumber ?? null;
    carrier = shipment.carrier ?? "usps";
  }
  if (!code) {
    return NextResponse.json({ error: "No tracking number" }, { status: 400 });
  }

  const sellerId = shipmentId
    ? (await prisma.shipment.findUnique({ where: { id: shipmentId }, include: { order: { select: { sellerId: true } } } }))?.order?.sellerId
    : session.user.id;
  const cred = sellerId ? await getSellerShippoCredential(sellerId) : null;
  if (!cred) {
    return NextResponse.json({ error: "Shipping not configured" }, { status: 503 });
  }

  try {
    const track = await fetchShippoTracking(cred, carrier, code);
    if (!track) {
      return NextResponse.json({ error: "Failed to get tracking" }, { status: 502 });
    }
    if (shipmentId) {
      await persistShipmentTrackingStatus({
        shipmentId,
        trackingStatus: track.trackingStatus,
      });
    }
    return NextResponse.json({
      status: track.trackingStatus,
      trackingDetails: track.trackingHistory,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to get tracking";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

