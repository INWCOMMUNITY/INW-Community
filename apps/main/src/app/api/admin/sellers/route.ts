import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";


export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const subscriptions = await prisma.subscription.findMany({
    where: { plan: "seller", status: "active" },
    include: {
      member: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          storeItemsSold: {
            select: {
              id: true,
              title: true,
              priceCents: true,
              quantity: true,
              status: true,
            },
          },
          storeOrdersAsSeller: {
            where: { status: { in: ["paid", "shipped", "delivered"] } },
            select: {
              totalCents: true,
              shippingCostCents: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const list = subscriptions.map((s) => {
    const member = s.member;
    const salesCents = member.storeOrdersAsSeller.reduce((sum, o) => sum + o.totalCents, 0);
    const shippingCents = member.storeOrdersAsSeller.reduce((sum, o) => sum + o.shippingCostCents, 0);
    return {
      subscriptionId: s.id,
      memberId: member.id,
      email: member.email,
      firstName: member.firstName,
      lastName: member.lastName,
      storeItems: member.storeItemsSold,
      salesCents,
      shippingCents,
      orderCount: member.storeOrdersAsSeller.length,
    };
  });

  return NextResponse.json(list);
}
