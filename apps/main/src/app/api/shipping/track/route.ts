import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getSellerShippoApiKey } from "@/lib/shippo-seller";

const SHIPPO_API = "https://api.goshippo.com";

function carrierToShippoToken(carrier: string): string {
  const c = carrier.toLowerCase().trim();
  if (c.includes("usps")) return "usps";
  if (c.includes("fedex")) return "fedex";
  if (c.includes("ups")) return "ups";
  if (c.includes("dhl")) return "dhl";
  return c || "usps";
}

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
  const apiKey = sellerId ? await getSellerShippoApiKey(sellerId) : null;
  if (!apiKey) {
    return NextResponse.json({ error: "Shipping not configured" }, { status: 503 });
  }

  try {
    const token = carrierToShippoToken(carrier);
    const res = await fetch(`${SHIPPO_API}/tracks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `ShippoToken ${apiKey}`,
      },
      body: JSON.stringify({
        carrier: token,
        tracking_number: code,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      tracking_status?: { status?: string };
      tracking_history?: unknown[];
      status?: string;
    };
    if (!res.ok) {
      const msg = typeof (data as { message?: string }).message === "string"
        ? (data as { message: string }).message
        : "Failed to get tracking";
      return NextResponse.json({ error: msg }, { status: res.status >= 500 ? 502 : 400 });
    }
    const status = data.tracking_status?.status ?? data.status ?? "UNKNOWN";
    const trackingDetails = data.tracking_history ?? [];
    return NextResponse.json({
      status,
      trackingDetails,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to get tracking";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
