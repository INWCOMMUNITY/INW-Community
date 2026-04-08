import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getCurrentSeasonId } from "@/lib/award-points";
import { verifiedMemberWhere } from "@/lib/member-public-visibility";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "10", 10) || 10, 1), 100);
    const seasonIdParam = searchParams.get("seasonId");
    const useSeason = seasonIdParam !== "balance"; // "balance" = legacy by spendable points; default = current season
    const seasonId = useSeason ? await getCurrentSeasonId() : null;

    if (seasonId) {
      const topBySeason = await prisma.memberSeasonPoints.findMany({
        where: { seasonId, pointsEarned: { gt: 0 }, member: verifiedMemberWhere },
        orderBy: { pointsEarned: "desc" },
        take: limit,
        include: {
          member: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profilePhotoUrl: true,
            },
          },
        },
      });
      return NextResponse.json(
        topBySeason.map((msp) => ({
          id: msp.member.id,
          firstName: msp.member.firstName,
          lastName: msp.member.lastName,
          profilePhotoUrl: msp.member.profilePhotoUrl,
          points: msp.pointsEarned,
        }))
      );
    }

    // No current season (or seasonId=balance): fallback to ranking by spendable balance
    const topMembers = await prisma.member.findMany({
      where: { points: { gt: 0 }, ...verifiedMemberWhere },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        profilePhotoUrl: true,
        points: true,
      },
      orderBy: { points: "desc" },
      take: limit,
    });
    return NextResponse.json(topMembers);
  } catch {
    return NextResponse.json([]);
  }
}
