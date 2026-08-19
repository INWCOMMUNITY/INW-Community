import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { createShippingFulfillment } from "@/lib/channels/ebay/fulfillment-orders";
import { describeEbayThrownError } from "@/lib/channels/ebay/errors";

export const dynamic = "force-dynamic";

/** POST /api/channels/ebay/orders/[orderId]/fulfillment */
export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } }
) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await getMemberConnectionContext(userId, "ebay");
  if (!ctx) return NextResponse.json({ error: "eBay not connected" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    lineItems?: { lineItemId: string; quantity: number }[];
    trackingNumber?: string;
    shippingCarrierCode?: string;
  } | null;

  if (!body?.trackingNumber?.trim() || !body.shippingCarrierCode?.trim()) {
    return NextResponse.json(
      { error: "trackingNumber and shippingCarrierCode are required" },
      { status: 400 }
    );
  }
  if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) {
    return NextResponse.json({ error: "lineItems are required" }, { status: 400 });
  }

  try {
    await createShippingFulfillment({
      accessToken: ctx.accessToken,
      orderId: params.orderId,
      lineItems: body.lineItems,
      trackingNumber: body.trackingNumber.trim(),
      shippingCarrierCode: body.shippingCarrierCode.trim(),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: describeEbayThrownError(e) }, { status: 502 });
  }
}
