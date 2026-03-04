import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const redemptions = await prisma.rewardRedemption.findMany({
    where: { memberId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      reward: {
        select: {
          id: true,
          title: true,
          imageUrl: true,
          pointsRequired: true,
          business: { select: { name: true, slug: true } },
        },
      },
    },
  });
  return NextResponse.json({
    redemptions: redemptions.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      pointsSpent: r.pointsSpent,
      reward: r.reward
        ? {
            id: r.reward.id,
            title: r.reward.title,
            imageUrl: r.reward.imageUrl,
            pointsRequired: r.reward.pointsRequired,
            business: r.reward.business,
          }
        : null,
    })),
  });
}
