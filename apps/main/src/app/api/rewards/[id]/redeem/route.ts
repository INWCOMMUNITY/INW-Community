import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: rewardId } = await params;
  const reward = await prisma.reward.findUnique({
    where: { id: rewardId, status: "active" },
    include: { business: { select: { name: true } } },
  });
  if (!reward) {
    return NextResponse.json({ error: "Reward not found or no longer available" }, { status: 404 });
  }
  if (reward.timesRedeemed >= reward.redemptionLimit) {
    return NextResponse.json({ error: "This reward has been fully redeemed" }, { status: 400 });
  }
  const member = await prisma.member.findUnique({
    where: { id: session.user.id },
    select: { points: true },
  });
  if (!member || member.points < reward.pointsRequired) {
    return NextResponse.json(
      { error: `You need ${reward.pointsRequired} points. You have ${member?.points ?? 0}.` },
      { status: 400 }
    );
  }
  await prisma.$transaction([
    prisma.member.update({
      where: { id: session.user.id },
      data: { points: { decrement: reward.pointsRequired } },
    }),
    prisma.reward.update({
      where: { id: rewardId },
      data: { timesRedeemed: { increment: 1 } },
    }),
    prisma.rewardRedemption.create({
      data: {
        memberId: session.user.id,
        rewardId,
        pointsSpent: reward.pointsRequired,
      },
    }),
  ]);
  const updatedReward = await prisma.reward.findUnique({
    where: { id: rewardId },
    select: { timesRedeemed: true, redemptionLimit: true },
  });
  if (updatedReward && updatedReward.timesRedeemed >= updatedReward.redemptionLimit) {
    await prisma.reward.update({
      where: { id: rewardId },
      data: { status: "redeemed_out" },
    });
  }
  return NextResponse.json({ ok: true });
}
