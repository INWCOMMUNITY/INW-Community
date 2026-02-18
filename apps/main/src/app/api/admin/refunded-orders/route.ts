import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orders = await prisma.storeOrder.findMany({
    where: { status: "refunded" },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      buyer: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      seller: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      items: {
        include: {
          storeItem: { select: { title: true, id: true } },
        },
      },
    },
  });
  return NextResponse.json(orders);
}
