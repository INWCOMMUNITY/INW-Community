import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { awardCouponRedeemBadges, type EarnedBadge } from "@/lib/badge-award";

const POINTS_PER_REDEEM = 10;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const coupon = await prisma.coupon.findUnique({
    where: { id },
    include: { business: { select: { memberId: true } } },
  });
  if (!coupon) {
    return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
  }

  if (!coupon.secretKey) {
    return NextResponse.json({ error: "This coupon does not have a secret key" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const submittedKey = typeof body?.secretKey === "string" ? body.secretKey.trim() : "";

  if (!submittedKey || submittedKey.toLowerCase() !== coupon.secretKey.toLowerCase()) {
    return NextResponse.json({ error: "Incorrect secret key" }, { status: 403 });
  }

  const sub = await prisma.subscription.findFirst({
    where: {
      memberId: userId,
      plan: { in: ["subscribe", "sponsor", "seller"] },
      status: "active",
    },
  });
  if (!sub) {
    return NextResponse.json({ error: "Active subscription required" }, { status: 403 });
  }

  if (coupon.business.memberId === userId) {
    return NextResponse.json({ error: "You cannot redeem your own coupon" }, { status: 403 });
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const usedToday = await prisma.couponRedeem.count({
    where: { couponId: id, memberId: userId, createdAt: { gte: todayStart, lt: todayEnd } },
  });
  if (usedToday > 0) {
    return NextResponse.json({ error: "You already redeemed this coupon today. Come back tomorrow!" }, { status: 429 });
  }

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const usedThisMonth = await prisma.couponRedeem.count({
    where: { couponId: id, memberId: userId, createdAt: { gte: monthStart } },
  });
  if (usedThisMonth >= coupon.maxMonthlyUses) {
    return NextResponse.json(
      { error: `You've reached the max of ${coupon.maxMonthlyUses} use${coupon.maxMonthlyUses === 1 ? "" : "s"} this month for this coupon.` },
      { status: 429 }
    );
  }

  await prisma.$transaction([
    prisma.couponRedeem.create({
      data: {
        couponId: id,
        memberId: userId,
        pointsAwarded: POINTS_PER_REDEEM,
      },
    }),
    prisma.member.update({
      where: { id: userId },
      data: {
        points: { increment: POINTS_PER_REDEEM },
        couponsRedeemed: { increment: 1 },
      },
    }),
  ]);

  let earnedBadges: EarnedBadge[] = [];
  try {
    earnedBadges = await awardCouponRedeemBadges(userId);
  } catch {
    // badge errors shouldn't block coupon redemption
  }

  return NextResponse.json({
    ok: true,
    pointsAwarded: POINTS_PER_REDEEM,
    usedThisMonth: usedThisMonth + 1,
    maxMonthlyUses: coupon.maxMonthlyUses,
    earnedBadges,
  });
}
