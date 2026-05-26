import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";
import { NWC_PAID_PLAN_ACCESS_STATUSES } from "@/lib/nwc-paid-subscription";

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const members = await prisma.member.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      city: true,
      status: true,
      createdAt: true,
      _count: { select: { subscriptions: true, businesses: true } },
    },
  });

  const memberIds = members.map((m) => m.id);
  const activeBusinessSubs =
    memberIds.length === 0
      ? []
      : await prisma.subscription.findMany({
          where: {
            memberId: { in: memberIds },
            plan: { in: ["sponsor", "seller"] },
            status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
          },
          select: { memberId: true },
        });
  const activeBusinessSubMemberIds = new Set(activeBusinessSubs.map((s) => s.memberId));

  return NextResponse.json(
    members.map((m) => ({
      ...m,
      canPauseSubscriptionRetainProfile:
        m._count.businesses > 0 && activeBusinessSubMemberIds.has(m.id),
    }))
  );
}
