import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";

function isCuid(s: string): boolean {
  return /^c[a-z0-9]{24}$/i.test(s);
}

/**
 * GET /api/sellers/[slug]
 * Seller storefront detail: business + store items
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const business = await prisma.business.findFirst({
      where: isCuid(slug) ? { id: slug } : { slug },
      include: {
        member: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        storeItems: {
          where: { status: "active", quantity: { gt: 0 } },
          select: {
            id: true,
            title: true,
            slug: true,
            description: true,
            photos: true,
            category: true,
            priceCents: true,
            quantity: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!business) {
      return NextResponse.json({ error: "Seller not found" }, { status: 404 });
    }

    const sellerSub = await prisma.subscription.findFirst({
      where: { memberId: business.memberId, plan: "seller", status: "active" },
    });
    if (!sellerSub) {
      return NextResponse.json({ error: "Seller not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: business.id,
      name: business.name,
      slug: business.slug,
      shortDescription: business.shortDescription,
      fullDescription: business.fullDescription,
      website: business.website,
      phone: business.phone,
      email: business.email,
      logoUrl: business.logoUrl,
      coverPhotoUrl: business.coverPhotoUrl,
      address: business.address,
      city: business.city,
      categories: business.categories,
      hoursOfOperation: business.hoursOfOperation,
      photos: business.photos,
      member: business.member,
      storeItems: business.storeItems,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
