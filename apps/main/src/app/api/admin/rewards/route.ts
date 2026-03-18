import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rewards = await prisma.reward.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      business: { select: { id: true, name: true, slug: true } },
      season: { select: { id: true, name: true, startDate: true, endDate: true } },
    },
  });

  return NextResponse.json(
    rewards.map((r) => ({
      id: r.id,
      title: r.title,
      pointsRequired: r.pointsRequired,
      redemptionLimit: r.redemptionLimit,
      timesRedeemed: r.timesRedeemed,
      status: r.status,
      seasonId: r.seasonId,
      season: r.season
        ? {
            id: r.season.id,
            name: r.season.name,
            startDate: r.season.startDate.toISOString().slice(0, 10),
            endDate: r.season.endDate.toISOString().slice(0, 10),
          }
        : null,
      business: r.business,
    }))
  );
}
