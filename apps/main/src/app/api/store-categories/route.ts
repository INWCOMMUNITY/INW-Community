import { NextResponse } from "next/server";
import { prisma } from "database";
import { STORE_CATEGORIES } from "@/lib/store-categories";

export const dynamic = "force-dynamic";

function slugifyCategory(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function GET() {
  // Return prebuilt categories with their subcategories and item counts
  const categoriesWithStats = await Promise.all(
    STORE_CATEGORIES.map(async (cat) => {
      const itemCount = await prisma.storeItem.count({
        where: {
          OR: [{ category: cat.label }, { secondaryCategory: cat.label }],
          status: "active",
          quantity: { gt: 0 },
          member: { stripeConnectAccountId: { not: null } },
        },
      });
      return {
        label: cat.label,
        slug: slugifyCategory(cat.label),
        subcategories: cat.subcategories,
        itemCount,
      };
    })
  );

  return NextResponse.json({ categories: categoriesWithStats });
}
