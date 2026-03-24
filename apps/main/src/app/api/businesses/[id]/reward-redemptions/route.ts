import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";

/**
 * List reward redemptions for a business the authenticated member owns.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: businessId } = await params;

  const business = await prisma.business.findFirst({
    where: { id: businessId, memberId: session.user.id },
    select: { id: true, name: true },
  });
  if (!business) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sellerSub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSellerPlanAccess(session.user.id),
  });
  const hasSellerPlan = !!sellerSub;

  const rows = await prisma.rewardRedemption.findMany({
    where: { reward: { businessId } },
    orderBy: { createdAt: "desc" },
    include: {
      reward: {
        select: { id: true, title: true, needsShipping: true, imageUrl: true },
      },
      member: {
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      },
    },
  });

  return NextResponse.json({
    businessId: business.id,
    businessName: business.name,
    hasSellerPlan,
    redemptions: rows.map((r) => {
      const displayName =
        r.contactName?.trim() ||
        `${r.member.firstName ?? ""} ${r.member.lastName ?? ""}`.trim() ||
        "Member";
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        pointsSpent: r.pointsSpent,
        contactName: r.contactName ?? displayName,
        contactEmail: r.contactEmail ?? r.member.email,
        contactPhone: r.contactPhone ?? r.member.phone,
        notesToBusiness: r.notesToBusiness,
        shippingAddress: r.shippingAddress,
        storeOrderId: r.storeOrderId,
        fulfillmentStatus: r.fulfillmentStatus,
        reward: r.reward,
        memberId: r.member.id,
      };
    }),
  });
}
