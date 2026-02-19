import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";


export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sponsors = await prisma.subscription.findMany({
    where: { plan: "sponsor", status: "active" },
    include: {
      member: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          businesses: {
            select: {
              id: true,
              name: true,
              slug: true,
              city: true,
              categories: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const list = sponsors.map((s) => ({
    subscriptionId: s.id,
    memberId: s.member.id,
    email: s.member.email,
    firstName: s.member.firstName,
    lastName: s.member.lastName,
    businesses: s.member.businesses,
  }));

  return NextResponse.json(list);
}
