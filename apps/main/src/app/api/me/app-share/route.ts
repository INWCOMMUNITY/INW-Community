import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { awardSpreadingTheWordBadge } from "@/lib/badge-award";
import { refreshMemberBadgeProgress } from "@/lib/member-badge-progress";

const SPREAD_TARGET = 5;

/**
 * GET /api/me/app-share — how many times this member completed Share from the app (for Spreading the Word).
 */
export async function GET(req: NextRequest) {
  const session =
    (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const count = await prisma.memberAppShare.count({ where: { memberId: userId } });
  return NextResponse.json({ count, target: SPREAD_TARGET });
}

/**
 * POST /api/me/app-share — record one completed share (call after native Share sheet succeeds).
 */
export async function POST(req: NextRequest) {
  const session =
    (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.memberAppShare.create({
    data: { memberId: userId },
  });

  const [earnedBadges] = await Promise.all([
    awardSpreadingTheWordBadge(userId),
    refreshMemberBadgeProgress(userId),
  ]);

  const count = await prisma.memberAppShare.count({ where: { memberId: userId } });

  return NextResponse.json({
    count,
    target: SPREAD_TARGET,
    earnedBadges,
  });
}
