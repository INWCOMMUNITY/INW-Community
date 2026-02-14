import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

/**
 * GET /api/me/policies
 * Returns policy text and offer flags for resale listing form.
 * Uses raw SQL for offer columns to avoid Prisma schema dependency.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const member = await prisma.member.findUnique({
      where: { id: userId },
      select: {
        sellerShippingPolicy: true,
        sellerLocalDeliveryPolicy: true,
        sellerPickupPolicy: true,
      },
    });
    if (!member) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    let offerShipping = true;
    let offerLocalDelivery = true;
    let offerLocalPickup = true;
    try {
      const rows = await prisma.$queryRaw<
        { offer_shipping: boolean | null; offer_local_delivery: boolean | null; offer_local_pickup: boolean | null }[]
      >`SELECT offer_shipping, offer_local_delivery, offer_local_pickup FROM "Member" WHERE id = ${userId}`;
      if (rows[0]) {
        if (rows[0].offer_shipping !== null) offerShipping = rows[0].offer_shipping;
        if (rows[0].offer_local_delivery !== null) offerLocalDelivery = rows[0].offer_local_delivery;
        if (rows[0].offer_local_pickup !== null) offerLocalPickup = rows[0].offer_local_pickup;
      }
    } catch {
      // Columns may not exist; keep defaults
    }
    return NextResponse.json({
      sellerShippingPolicy: member.sellerShippingPolicy ?? "",
      sellerLocalDeliveryPolicy: member.sellerLocalDeliveryPolicy ?? "",
      sellerPickupPolicy: member.sellerPickupPolicy ?? "",
      offerShipping,
      offerLocalDelivery,
      offerLocalPickup,
    });
  } catch (e) {
    const err = e as Error;
    console.error("[GET /api/me/policies]", err);
    return NextResponse.json(
      { error: process.env.NODE_ENV === "development" ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
