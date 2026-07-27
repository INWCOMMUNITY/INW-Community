import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isUserAdmin } from "@/lib/admin-check";

/**
 * GET /api/admin/analytics/friends
 * Returns friend request analytics for the admin dashboard.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !(await isUserAdmin(session.user.email))) {
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
    acceptedWithTimes,
  ] = await Promise.all([
    prisma.friendRequest.count({
      where: { createdAt: { gte: today } },
    }),
    prisma.friendRequest.count({
      where: { status: "accepted", updatedAt: { gte: today } },
    }),
    prisma.friendRequest.count({
      where: { status: "declined", updatedAt: { gte: today } },
    }),
    prisma.friendRequest.count({
      where: { createdAt: { gte: yesterday, lt: today } },
    }),
    prisma.friendRequest.count({
      where: { status: "accepted", updatedAt: { gte: yesterday, lt: today } },
    }),
    prisma.friendRequest.count({
      where: { createdAt: { gte: weekAgo } },
    }),
    prisma.friendRequest.count({
      where: { status: "accepted", updatedAt: { gte: weekAgo } },
    }),
    prisma.friendRequest.count({
      where: { status: "pending" },
    }),
    prisma.friendRequest.count({
      where: { status: "accepted" },
    }),
    prisma.friendRequest.findMany({
      where: {
        status: "accepted",
        updatedAt: { gte: weekAgo },
      },
      select: { createdAt: true, updatedAt: true },
      take: 100,
    }),
  ]);

  // Calculate average response time (time between creation and acceptance)
  let avgResponseTimeHours: number | null = null;
  if (acceptedWithTimes.length > 0) {
    const totalMs = acceptedWithTimes.reduce((sum, r) => {
      return sum + (r.updatedAt.getTime() - r.createdAt.getTime());
    }, 0);
    avgResponseTimeHours = Math.round((totalMs / acceptedWithTimes.length / 1000 / 60 / 60) * 10) / 10;
  }

  // Acceptance rate this week
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
    avgResponseTimeHours,
  });
}
