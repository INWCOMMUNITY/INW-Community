import { prisma } from "database";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";

export type BusinessRewardRedemptionsPayload = {
  businessId: string;
  businessName: string;
  hasSellerPlan: boolean;
  redemptions: Array<{
    id: string;
    createdAt: string;
    pointsSpent: number;
    contactName: string;
    contactEmail: string | null;
    contactPhone: string | null;
    notesToBusiness: string | null;
    shippingAddress: unknown;
    storeOrderId: string | null;
    fulfillmentStatus: string | null;
    reward: { id: string; title: string; needsShipping: boolean; imageUrl: string | null };
    memberId: string;
  }>;
};

/**
 * List reward redemptions for a business owned by memberId (mobile + API routes).
 */
export async function getBusinessRewardRedemptionsForOwner(
  businessId: string,
  memberId: string
): Promise<{ ok: true; data: BusinessRewardRedemptionsPayload } | { ok: false; status: 404 }> {
  const business = await prisma.business.findFirst({
    where: { id: businessId, memberId },
    select: { id: true, name: true },
  });
  if (!business) {
    return { ok: false, status: 404 };
  }

  const sellerSub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSellerPlanAccess(memberId),
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

  const redemptions = rows.map((r) => {
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
  });

  return {
    ok: true,
    data: {
      businessId: business.id,
      businessName: business.name,
      hasSellerPlan,
      redemptions,
    },
  };
}
