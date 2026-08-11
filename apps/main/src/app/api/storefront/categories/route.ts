import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { STORE_CATEGORIES, slugifyStoreCategory } from "@/lib/store-categories";

export const dynamic = "force-dynamic";
export const revalidate = 300; // 5 minute cache

type CategoryNode = {
  name: string;
  slug: string;
  count: number;
  subcategories: {
    name: string;
    slug: string;
    count: number;
  }[];
};

const activeItemWhere: Prisma.StoreItemWhereInput = {
  status: "active",
  quantity: { gt: 0 },
  AND: [
    { OR: [{ category: null }, { category: { not: "Test" } }] },
    { OR: [{ secondaryCategory: null }, { secondaryCategory: { not: "Test" } }] },
  ],
};

/**
 * GET /api/storefront/categories
 * Returns a hierarchical category tree with item counts for storefront navigation.
 */
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const includeEmpty = searchParams.get("includeEmpty") === "true";
  const sellerId = searchParams.get("sellerId") || null;

  const where: Prisma.StoreItemWhereInput = {
    ...activeItemWhere,
    ...(sellerId ? { memberId: sellerId } : {}),
  };

  const categoryGroups = await prisma.storeItem.groupBy({
    by: ["category", "subcategory"],
    where,
    _count: { id: true },
  });

  const secondaryGroups = await prisma.storeItem.groupBy({
    by: ["secondaryCategory"],
    where: {
      ...where,
      secondaryCategory: { not: null },
    },
    _count: { id: true },
  });

  const secondaryCounts = new Map<string, number>();
  for (const row of secondaryGroups) {
    const cat = row.secondaryCategory?.trim();
    if (cat) {
      secondaryCounts.set(cat, (secondaryCounts.get(cat) || 0) + row._count.id);
    }
  }

  const catSubMap = new Map<string, Map<string, number>>();
  const catTotals = new Map<string, number>();
  
  for (const row of categoryGroups) {
    const cat = row.category?.trim();
    if (!cat) continue;
    
    const subMap = catSubMap.get(cat) || new Map<string, number>();
    const sub = row.subcategory?.trim();
    
    if (sub) {
      subMap.set(sub, (subMap.get(sub) || 0) + row._count.id);
    }
    catSubMap.set(cat, subMap);
    catTotals.set(cat, (catTotals.get(cat) || 0) + row._count.id);
  }

  for (const [cat, count] of secondaryCounts) {
    catTotals.set(cat, (catTotals.get(cat) || 0) + count);
    if (!catSubMap.has(cat)) {
      catSubMap.set(cat, new Map());
    }
  }

  const categories: CategoryNode[] = [];

  for (const preset of STORE_CATEGORIES) {
    const catCount = catTotals.get(preset.label) || 0;
    
    if (!includeEmpty && catCount === 0) continue;
    
    const subMap = catSubMap.get(preset.label) || new Map<string, number>();
    const subcategories: CategoryNode["subcategories"] = [];
    
    for (const subName of preset.subcategories) {
      const subCount = subMap.get(subName) || 0;
      if (!includeEmpty && subCount === 0) continue;
      
      subcategories.push({
        name: subName,
        slug: slugifyStoreCategory(subName),
        count: subCount,
      });
    }

    categories.push({
      name: preset.label,
      slug: slugifyStoreCategory(preset.label),
      count: catCount,
      subcategories,
    });
  }

  const customCategories = new Set<string>();
  for (const cat of catTotals.keys()) {
    if (!STORE_CATEGORIES.find((p) => p.label === cat)) {
      customCategories.add(cat);
    }
  }

  for (const cat of customCategories) {
    const catCount = catTotals.get(cat) || 0;
    if (!includeEmpty && catCount === 0) continue;
    
    const subMap = catSubMap.get(cat) || new Map<string, number>();
    const subcategories: CategoryNode["subcategories"] = [];
    
    for (const [subName, subCount] of subMap.entries()) {
      if (!includeEmpty && subCount === 0) continue;
      subcategories.push({
        name: subName,
        slug: slugifyStoreCategory(subName),
        count: subCount,
      });
    }

    categories.push({
      name: cat,
      slug: slugifyStoreCategory(cat),
      count: catCount,
      subcategories,
    });
  }

  const totalItems = await prisma.storeItem.count({ where });
  const uncategorizedCount = await prisma.storeItem.count({
    where: {
      ...where,
      category: null,
    },
  });

  return NextResponse.json({
    categories,
    totalItems,
    uncategorizedCount,
    includesSecondary: true,
  });
}
