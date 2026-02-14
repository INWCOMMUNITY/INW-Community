import { NextRequest, NextResponse } from "next/server";
import EasyPostClient from "@easypost/api";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

function getEasyPostClient() {
  const key = process.env.EASYPOST_API_KEY ?? "";
  return new EasyPostClient(key);
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const trackingNumber = searchParams.get("tracking");
  const shipmentId = searchParams.get("shipmentId");

  if (!trackingNumber && !shipmentId) {
    return NextResponse.json({ error: "Provide tracking or shipmentId" }, { status: 400 });
  }

  if (!process.env.EASYPOST_API_KEY) {
    return NextResponse.json({ error: "Shipping not configured" }, { status: 503 });
  }

  let code: string | null = trackingNumber;
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
  }
  if (!code) {
    return NextResponse.json({ error: "No tracking number" }, { status: 400 });
  }

  try {
    const client = getEasyPostClient();
    const tracker = await client.Tracker.create({ tracking_code: code });
    const t = tracker as { tracking_details?: unknown[]; status?: string };
    return NextResponse.json({
      status: t.status,
      trackingDetails: t.tracking_details ?? [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to get tracking";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
