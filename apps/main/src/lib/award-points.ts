import { prisma } from "database";

const now = () => new Date();

/**
 * Returns the current season id if there is a season whose startDate <= now <= endDate.
 * At most one such season should exist (admin responsibility).
 */
export async function getCurrentSeasonId(): Promise<string | null> {
  const season = await prisma.season.findFirst({
    where: {
      startDate: { lte: now() },
      endDate: { gte: now() },
    },
    select: { id: true },
  });
  return season?.id ?? null;
}

/**
 * Award points to a member: increments spendable balance, all-time earned, and current season earned.
 * Call this whenever points are awarded (scan, coupon redeem, order, admin).
 */
export async function awardPoints(memberId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  const seasonId = await getCurrentSeasonId();
  await prisma.$transaction([
    prisma.member.update({
      where: { id: memberId },
      data: {
        points: { increment: amount },
        allTimePointsEarned: { increment: amount },
      },
    }),
    ...(seasonId
      ? [
          prisma.memberSeasonPoints.upsert({
            where: {
              memberId_seasonId: { memberId, seasonId },
            },
            create: { memberId, seasonId, pointsEarned: amount },
            update: { pointsEarned: { increment: amount } },
          }),
        ]
      : []),
  ]);
}
