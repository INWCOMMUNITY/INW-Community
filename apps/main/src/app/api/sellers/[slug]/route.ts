import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { parseSubcategoriesByPrimary } from "@/lib/business-categories";
import { photosExcludingLogo } from "@/lib/business-photos";
import { extractBusinessDisplayCity } from "@/lib/city-utils";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";

export const dynamic = "force-dynamic";

const noStoreJson = {
  headers: { "Cache-Control": "private, no-store, max-age=0" },
} as const;

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
    // Only show seller store when they have Stripe Connect (payment/redirect can function).
    const business = await prisma.business.findFirst({
      where: {
        ...(isCuid(slug) ? { id: slug } : { slug }),
        nameApprovalStatus: "approved",
        member: { stripeConnectAccountId: { not: null } },
      },
      include: {
        member: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            sellerLocalDeliveryPolicy: true,
            sellerPickupPolicy: true,
            sellerShippingPolicy: true,
            sellerReturnPolicy: true,
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
      return NextResponse.json({ error: "Seller not found" }, { status: 404, ...noStoreJson });
    }

    const sellerSub = await prisma.subscription.findFirst({
      where: prismaWhereMemberSellerPlanAccess(business.memberId),
    });
    if (!sellerSub) {
      return NextResponse.json({ error: "Seller not found" }, { status: 404, ...noStoreJson });
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
      city: extractBusinessDisplayCity(business.city) ?? business.city,
      categories: business.categories,
      subcategoriesByPrimary: parseSubcategoriesByPrimary(business.subcategoriesByPrimary),
      hoursOfOperation: business.hoursOfOperation,
      photos: photosExcludingLogo(business.photos, business.logoUrl),
      member: business.member,
      storeItems: business.storeItems,
      sellerLocalDeliveryPolicy: business.member.sellerLocalDeliveryPolicy ?? null,
      sellerPickupPolicy: business.member.sellerPickupPolicy ?? null,
      sellerShippingPolicy: business.member.sellerShippingPolicy ?? null,
      sellerReturnPolicy: business.member.sellerReturnPolicy ?? null,
    }, noStoreJson);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500, ...noStoreJson });
  }
}
