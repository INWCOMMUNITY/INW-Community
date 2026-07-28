import { NextResponse } from "next/server";
import { prisma } from "database";

export const dynamic = "force-dynamic";

export async function GET() {
  const categories = await prisma.storeCategory.findMany({
    orderBy: { sortOrder: "asc" },
  });

  const categoryStats = await Promise.all(
    categories.map(async (cat) => {
      const itemCount = await prisma.storeItem.count({
        where: {
          OR: [{ category: cat.name }, { secondaryCategory: cat.name }],
          status: "active",
          quantity: { gt: 0 },
          member: { stripeConnectAccountId: { not: null } },
        },
      });
      return { ...cat, itemCount };
    })
  );

  return NextResponse.json(categoryStats);
}
