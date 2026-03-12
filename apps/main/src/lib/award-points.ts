import { prisma } from "database";

const now = () => new Date();

/**
 * Returns the current season id if there is a season whose startDate <= now <= endDate.
 * At most one such season should exist (admin responsibility).
 * Returns null if the season table does not exist (e.g. migrations not yet run) or on any error.
 */
export async function getCurrentSeasonId(): Promise<string | null> {
  try {
    const season = await prisma.season.findFirst({
      where: {
        startDate: { lte: now() },
        endDate: { gte: now() },
      },
      select: { id: true },
    });
    return season?.id ?? null;
  } catch {
    return null;
  }
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

/**
 * Deduct points from a member (e.g. when an order is refunded or canceled).
 * Decrements spendable balance, all-time earned, and current season earned; never goes below zero.
 */
export async function deductPoints(memberId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  const seasonId = await getCurrentSeasonId();
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { points: true, allTimePointsEarned: true },
  });
  if (!member) return;
  const deductFromPoints = Math.min(amount, member.points);
  const deductFromAllTime = Math.min(amount, member.allTimePointsEarned);
  if (deductFromPoints <= 0 && deductFromAllTime <= 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.member.update({
      where: { id: memberId },
      data: {
        points: { decrement: deductFromPoints },
        allTimePointsEarned: { decrement: deductFromAllTime },
      },
    });
    if (seasonId && amount > 0) {
      const existing = await tx.memberSeasonPoints.findUnique({
        where: { memberId_seasonId: { memberId, seasonId } },
        select: { pointsEarned: true },
      });
      const seasonDeduct = Math.min(amount, existing?.pointsEarned ?? 0);
      if (seasonDeduct > 0) {
        await tx.memberSeasonPoints.update({
          where: { memberId_seasonId: { memberId, seasonId } },
          data: { pointsEarned: { decrement: seasonDeduct } },
        });
      }
    }
  });
}
