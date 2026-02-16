import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sub = await prisma.subscription.findFirst({
    where: { memberId: userId, plan: "seller", status: "active" },
  });
  if (!sub) {
    return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
  }
  const member = await prisma.member.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });
  // Use raw query for new columns (works even if Prisma client wasn't regenerated)
  let sellerLocalDeliveryPolicy: string | null = null;
  let sellerPickupPolicy: string | null = null;
  let sellerShippingPolicy: string | null = null;
  let sellerReturnPolicy: string | null = null;
  let packingSlipNote: string | null = null;
  let offerShipping: boolean = true;
  let offerLocalDelivery: boolean = true;
  let offerLocalPickup: boolean = true;
  try {
    const rows = await prisma.$queryRaw<
      { seller_local_delivery_policy: string | null; seller_pickup_policy: string | null; seller_shipping_policy: string | null; seller_return_policy: string | null; packing_slip_note: string | null; offer_shipping: boolean | null; offer_local_delivery: boolean | null; offer_local_pickup: boolean | null }[]
    >`SELECT seller_local_delivery_policy, seller_pickup_policy, seller_shipping_policy, seller_return_policy, packing_slip_note, offer_shipping, offer_local_delivery, offer_local_pickup FROM "Member" WHERE id = ${userId}`;
    if (rows[0]) {
      sellerLocalDeliveryPolicy = rows[0].seller_local_delivery_policy;
      sellerPickupPolicy = rows[0].seller_pickup_policy;
      sellerShippingPolicy = rows[0].seller_shipping_policy;
      sellerReturnPolicy = rows[0].seller_return_policy;
      packingSlipNote = rows[0].packing_slip_note;
      if (rows[0].offer_shipping !== null) offerShipping = rows[0].offer_shipping;
      if (rows[0].offer_local_delivery !== null) offerLocalDelivery = rows[0].offer_local_delivery;
      if (rows[0].offer_local_pickup !== null) offerLocalPickup = rows[0].offer_local_pickup;
    }
  } catch {
    // Columns may not exist if db push wasn't run
  }
  const business = await prisma.business.findFirst({
    where: { memberId: userId },
  });
  const connectStatus = await prisma.member.findUnique({
    where: { id: userId },
    select: { stripeConnectAccountId: true },
  });
  return NextResponse.json({
    member: member ?? { firstName: "", lastName: "", email: "" },
    sellerLocalDeliveryPolicy,
    sellerPickupPolicy,
    sellerShippingPolicy,
    sellerReturnPolicy,
    packingSlipNote,
    offerShipping,
    offerLocalDelivery,
    offerLocalPickup,
    business: business
      ? {
          id: business.id,
          name: business.name,
          phone: business.phone,
          email: business.email,
          fullDescription: business.fullDescription,
          website: business.website,
          address: business.address,
          city: business.city,
          logoUrl: business.logoUrl,
          coverPhotoUrl: business.coverPhotoUrl,
          slug: business.slug,
        }
      : null,
    hasStripeConnect: !!connectStatus?.stripeConnectAccountId,
  });
}

const patchSchema = {
  business: {
    name: "string",
    phone: "string",
    email: "string",
    fullDescription: "string",
    website: "string",
    address: "string",
  },
  sellerLocalDeliveryPolicy: "string",
  sellerPickupPolicy: "string",
  sellerShippingPolicy: "string",
  sellerReturnPolicy: "string",
};

export async function PATCH(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sub = await prisma.subscription.findFirst({
    where: { memberId: userId, plan: "seller", status: "active" },
  });
  if (!sub) {
    return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // Update policy fields via raw query (works even if Prisma client wasn't regenerated)
  const updates: string[] = [];
  const values: (string | null)[] = [];
  let i = 1;
  if (typeof body.sellerLocalDeliveryPolicy === "string") {
    updates.push(`seller_local_delivery_policy = $${i++}`);
    values.push(body.sellerLocalDeliveryPolicy.trim() || null);
  }
  if (typeof body.sellerPickupPolicy === "string") {
    updates.push(`seller_pickup_policy = $${i++}`);
    values.push(body.sellerPickupPolicy.trim() || null);
  }
  if (typeof body.sellerShippingPolicy === "string") {
    updates.push(`seller_shipping_policy = $${i++}`);
    values.push(body.sellerShippingPolicy.trim() || null);
  }
  if (typeof body.sellerReturnPolicy === "string") {
    updates.push(`seller_return_policy = $${i++}`);
    values.push(body.sellerReturnPolicy.trim() || null);
  }
  if (typeof body.packingSlipNote === "string") {
    updates.push(`packing_slip_note = $${i++}`);
    values.push(body.packingSlipNote.trim() || null);
  }
  if (updates.length > 0) {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "Member" SET ${updates.join(", ")} WHERE id = $${i}`,
        ...values,
        userId
      );
    } catch {
      // Columns may not exist if db push wasn't run
    }
  }
  const biz = body.business as Record<string, string> | undefined;
  if (biz && typeof biz === "object") {
    const existing = await prisma.business.findFirst({
      where: { memberId: userId },
    });
        const slug =
          existing?.slug ??
          ((biz.name || "store")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "store");
    if (existing) {
      await prisma.business.update({
        where: { id: existing.id },
        data: {
          name: typeof biz.name === "string" ? biz.name : existing.name,
          phone: typeof biz.phone === "string" ? biz.phone : existing.phone,
          email: typeof biz.email === "string" ? biz.email : existing.email,
          fullDescription:
            typeof biz.fullDescription === "string" ? biz.fullDescription : existing.fullDescription,
          website: typeof biz.website === "string" ? biz.website : existing.website,
          address: typeof biz.address === "string" ? biz.address : existing.address,
          logoUrl: biz.logoUrl !== undefined ? (typeof biz.logoUrl === "string" && biz.logoUrl.trim() ? biz.logoUrl.trim() : null) : existing.logoUrl,
          coverPhotoUrl: biz.coverPhotoUrl !== undefined ? (typeof biz.coverPhotoUrl === "string" && biz.coverPhotoUrl.trim() ? biz.coverPhotoUrl.trim() : null) : existing.coverPhotoUrl,
        },
      });
    } else {
      const business = await prisma.business.create({
        data: {
          memberId: userId,
          name: typeof biz.name === "string" ? biz.name : "My Store",
          shortDescription: null,
          fullDescription: typeof biz.fullDescription === "string" ? biz.fullDescription : null,
          phone: typeof biz.phone === "string" ? biz.phone : null,
          email: typeof biz.email === "string" ? biz.email : null,
          website: typeof biz.website === "string" ? biz.website : null,
          address: typeof biz.address === "string" ? biz.address : null,
          logoUrl: typeof biz.logoUrl === "string" ? biz.logoUrl : null,
          coverPhotoUrl: typeof biz.coverPhotoUrl === "string" ? biz.coverPhotoUrl : null,
          slug,
          photos: [],
        },
      });
      const { awardBusinessSignupBadges } = await import("@/lib/badge-award");
      awardBusinessSignupBadges(business.id).catch(() => {});
    }
  }
  return NextResponse.json({ ok: true });
}
