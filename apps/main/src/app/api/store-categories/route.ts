import { NextResponse } from "next/server";
import { prisma } from "database";
import { STORE_CATEGORIES, slugifyStoreCategory } from "@/lib/store-categories";
import { withPublicStockWhere } from "@/lib/store-item-public-access";

export const dynamic = "force-dynamic";

export async function GET() {
  // Return prebuilt categories with their subcategories and item counts
  const categoriesWithStats = await Promise.all(
    STORE_CATEGORIES.map(async (cat) => {
      const itemCount = await prisma.storeItem.count({
        where: withPublicStockWhere({
          OR: [{ category: cat.label }, { secondaryCategory: cat.label }],
          status: "active",
          member: { stripeConnectAccountId: { not: null } },
        }),
      });
      return {
        label: cat.label,
        slug: slugifyStoreCategory(cat.label),
        subcategories: cat.subcategories,
        itemCount,
      };
    })
  );

  return NextResponse.json({ categories: categoriesWithStats });
}
