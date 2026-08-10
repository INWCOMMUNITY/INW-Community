import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { STORE_CATEGORIES } from "@/lib/store-categories";

export const dynamic = "force-dynamic";

function slugifyCategory(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // First try database
  let category = await prisma.storeCategory.findUnique({
    where: { slug },
  });

  // Fall back to prebuilt categories if not in database
  if (!category) {
    const preset = STORE_CATEGORIES.find(
      (c) => slugifyCategory(c.label) === slug
    );
    if (preset) {
      category = {
        id: slug,
        name: preset.label,
        slug,
        description: null,
        bannerUrl: null,
        sortOrder: 0,
      };
    }
  }

  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  const items = await prisma.storeItem.findMany({
    where: {
      OR: [{ category: category.name }, { secondaryCategory: category.name }],
      status: "active",
      quantity: { gt: 0 },
      member: { stripeConnectAccountId: { not: null } },
    },
    select: {
      id: true,
      title: true,
      slug: true,
      photos: true,
      category: true,
      secondaryCategory: true,
      priceCents: true,
      quantity: true,
      shippingDisabled: true,
      localDeliveryAvailable: true,
      inStorePickupAvailable: true,
      shippingCostCents: true,
      business: { select: { id: true, name: true, slug: true, logoUrl: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const featuredSellers = await prisma.storeItem.groupBy({
    by: ["memberId"],
    where: {
      OR: [{ category: category.name }, { secondaryCategory: category.name }],
      status: "active",
      quantity: { gt: 0 },
      member: { stripeConnectAccountId: { not: null } },
    },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 5,
  });

  const sellerIds = featuredSellers.map((s) => s.memberId);
  const sellers = await prisma.member.findMany({
    where: { id: { in: sellerIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      businesses: {
        select: { id: true, name: true, slug: true, logoUrl: true },
        take: 1,
      },
    },
  });

  const sellerMap = new Map(sellers.map((s) => [s.id, s]));
  const featuredSellersWithInfo = featuredSellers
    .map((fs) => {
      const seller = sellerMap.get(fs.memberId);
      if (!seller) return null;
      const biz = seller.businesses[0];
      return {
        id: seller.id,
        name: biz?.name || `${seller.firstName} ${seller.lastName}`.trim() || "Seller",
        slug: biz?.slug ?? null,
        logoUrl: biz?.logoUrl ?? null,
        itemCount: fs._count.id,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const subcategories = await prisma.storeItem
    .findMany({
      where: {
        category: category.name,
        secondaryCategory: { not: null },
        status: "active",
        quantity: { gt: 0 },
        member: { stripeConnectAccountId: { not: null } },
      },
      select: { secondaryCategory: true },
      distinct: ["secondaryCategory"],
    })
    .then((items) =>
      items
        .map((i) => i.secondaryCategory)
        .filter((sc): sc is string => sc !== null)
        .sort()
    );

  return NextResponse.json({
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    bannerUrl: category.bannerUrl,
    itemCount: items.length,
    items,
    featuredSellers: featuredSellersWithInfo,
    subcategories,
  });
}
