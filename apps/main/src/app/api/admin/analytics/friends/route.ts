import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * GET /api/admin/analytics/friends
 * Returns friend request analytics for the admin dashboard.
 */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [
    sentToday,
    acceptedToday,
    declinedToday,
    sentYesterday,
    acceptedYesterday,
    sentThisWeek,
    acceptedThisWeek,
    totalPending,
    totalFriendships,
  ] = await Promise.all([
    prisma.friendRequest.count({
      where: { createdAt: { gte: today } },
    }),
    prisma.friendRequest.count({
      where: { status: "accepted", createdAt: { gte: today } },
    }),
    prisma.friendRequest.count({
      where: { status: "declined", createdAt: { gte: today } },
    }),
    prisma.friendRequest.count({
      where: { createdAt: { gte: yesterday, lt: today } },
    }),
    prisma.friendRequest.count({
      where: { status: "accepted", createdAt: { gte: yesterday, lt: today } },
    }),
    prisma.friendRequest.count({
      where: { createdAt: { gte: weekAgo } },
    }),
    prisma.friendRequest.count({
      where: { status: "accepted", createdAt: { gte: weekAgo } },
    }),
    prisma.friendRequest.count({
      where: { status: "pending" },
    }),
    prisma.friendRequest.count({
      where: { status: "accepted" },
    }),
  ]);

  const acceptanceRate = sentThisWeek > 0
    ? Math.round((acceptedThisWeek / sentThisWeek) * 100)
    : null;

  return NextResponse.json({
    today: {
      sent: sentToday,
      accepted: acceptedToday,
      declined: declinedToday,
    },
    yesterday: {
      sent: sentYesterday,
      accepted: acceptedYesterday,
    },
    thisWeek: {
      sent: sentThisWeek,
      accepted: acceptedThisWeek,
      acceptanceRate,
    },
    totals: {
      pending: totalPending,
      friendships: totalFriendships,
    },
    avgResponseTimeHours: null,
  });
}
