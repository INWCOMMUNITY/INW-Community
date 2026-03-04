import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { awardScannerBadges, awardCategoryScanBadges, type EarnedBadge } from "@/lib/badge-award";
import { awardPoints } from "@/lib/award-points";

const DEFAULT_POINTS = 10;

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { businessId } = await req.json();
    if (!businessId || typeof businessId !== "string") {
      return NextResponse.json({ error: "Missing businessId" }, { status: 400 });
    }

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, categories: true, memberId: true },
    });

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    if (business.memberId === session.user.id) {
      return NextResponse.json(
        { error: "You cannot scan your own business QR code." },
        { status: 400 }
      );
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const existingScan = await prisma.qRScan.findFirst({
      where: {
        memberId: session.user.id,
        businessId: business.id,
        scannedAt: { gte: startOfDay },
      },
    });

    if (existingScan) {
      return NextResponse.json(
        { error: "You've already scanned this business today. Come back tomorrow!" },
        { status: 429 }
      );
    }

    let pointsToAward = DEFAULT_POINTS;

    if (business.categories.length > 0) {
      const catConfig = await prisma.categoryPointsConfig.findFirst({
        where: { category: { in: business.categories } },
        orderBy: { pointsPerScan: "desc" },
      });
      if (catConfig) {
        pointsToAward = catConfig.pointsPerScan;
      }
    }

    const subscriber = await prisma.subscription.findFirst({
      where: { memberId: session.user.id, plan: "subscribe", status: "active" },
    });
    if (subscriber) {
      pointsToAward *= 2;
    }

    const scan = await prisma.qRScan.create({
      data: {
        memberId: session.user.id,
        businessId: business.id,
        pointsAwarded: pointsToAward,
      },
    });
    await awardPoints(session.user.id, pointsToAward);

    let earnedBadges: EarnedBadge[] = [];
    try {
      const [scannerBadges, catBadges] = await Promise.all([
        awardScannerBadges(session.user.id),
        awardCategoryScanBadges(session.user.id, business.categories),
      ]);
      earnedBadges = [...scannerBadges, ...catBadges];
    } catch {
      // badge errors shouldn't break the scan response
    }

    // Re-fetch points (balance) after award and any badge bonuses
    const member = await prisma.member.findUnique({ where: { id: session.user.id }, select: { points: true } });
    let totalPoints = member?.points ?? pointsToAward;
    if (earnedBadges.length > 0) {
      const updated = await prisma.member.findUnique({ where: { id: session.user.id }, select: { points: true } });
      if (updated) totalPoints = updated.points;
    }

    return NextResponse.json({
      ok: true,
      pointsAwarded: pointsToAward,
      totalPoints,
      businessName: business.name,
      scanId: scan.id,
      earnedBadges,
    });
  } catch (e) {
    console.error("[rewards/scan]", e);
    return NextResponse.json({ error: "Scan failed. Please try again." }, { status: 500 });
  }
}
