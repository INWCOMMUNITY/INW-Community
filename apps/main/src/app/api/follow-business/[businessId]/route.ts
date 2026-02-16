import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

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

  const { businessId } = await params;
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, memberId: true },
  });
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const sellerSub = await prisma.subscription.findFirst({
    where: { memberId: business.memberId, plan: "seller", status: "active" },
  });
  if (!sellerSub) {
    return NextResponse.json({ error: "Not a seller storefront" }, { status: 400 });
  }

  try {
    await prisma.followBusiness.upsert({
      where: {
        memberId_businessId: { memberId: session.user.id, businessId },
      },
      create: { memberId: session.user.id, businessId },
      update: {},
    });
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
