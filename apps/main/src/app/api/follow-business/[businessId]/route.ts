import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";

/**
 * POST /api/follow-business/[businessId] - Follow a seller's business
 * DELETE /api/follow-business/[businessId] - Unfollow
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ businessId: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const { businessId } = await params;
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, memberId: true, name: true, slug: true },
  });
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const sellerSub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSellerPlanAccess(business.memberId),
  });
  if (!sellerSub) {
    return NextResponse.json({ error: "Not a seller storefront" }, { status: 400 });
  }

  try {
    const existing = await prisma.followBusiness.findUnique({
      where: {
        memberId_businessId: { memberId: session.user.id, businessId },
      },
      select: { id: true },
    });
    await prisma.followBusiness.upsert({
      where: {
        memberId_businessId: { memberId: session.user.id, businessId },
      },
      create: { memberId: session.user.id, businessId },
      update: {},
    });
    if (!existing && business.memberId !== session.user.id) {
      const follower = await prisma.member.findUnique({
        where: { id: session.user.id },
        select: { firstName: true, lastName: true },
      });
      const who =
        follower != null
          ? [follower.firstName, follower.lastName].filter(Boolean).join(" ").trim() || "Someone"
          : "Someone";
      const { sendPushNotification } = await import("@/lib/send-push-notification");
      sendPushNotification(business.memberId, {
        category: "commerce",
        title: "New favorite business!",
        body: `${who} saved “${business.name}” as a favorite — tap to view your page.`,
        data: {
          screen: "business_profile",
          businessSlug: business.slug,
        },
      }).catch(() => {});
    }
    return NextResponse.json({ followed: true });
  } catch (e) {
    return NextResponse.json({ error: "Failed to follow" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ businessId: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const { businessId } = await params;
  try {
    await prisma.followBusiness.deleteMany({
      where: { memberId: session.user.id, businessId },
    });
    return NextResponse.json({ followed: false });
  } catch {
    return NextResponse.json({ followed: false });
  }
}
