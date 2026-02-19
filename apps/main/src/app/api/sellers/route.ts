import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { deduplicateCities } from "@/lib/city-utils";

/**
 * GET /api/sellers
 * List seller storefronts (businesses whose member has seller plan).
 * Query params: search, category, city
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl?.searchParams ?? new URLSearchParams();
    const list = searchParams.get("list");
    const search = searchParams.get("search")?.trim();
    const category = searchParams.get("category")?.trim();
    const city = searchParams.get("city")?.trim();

    const sellerMemberIds = await prisma.subscription.findMany({
      where: { plan: "seller", status: "active" },
      select: { memberId: true },
    });
    const memberIds = sellerMemberIds.map((s) => s.memberId);
    if (memberIds.length === 0) {
      if (list === "meta") {
        return NextResponse.json({ categories: [], cities: [] });
      }
      return NextResponse.json([]);
    }

    if (list === "meta") {
      const sellerBusinesses = await prisma.business.findMany({
        where: { memberId: { in: memberIds } },
        select: { categories: true, city: true },
      });
      const catSet = new Set(sellerBusinesses.flatMap((b) => b.categories).filter(Boolean));
      const cities = deduplicateCities(sellerBusinesses.map((c) => c.city));
      return NextResponse.json({
        categories: Array.from(catSet).sort(),
        cities,
      });
    }

    const businesses = await prisma.business.findMany({
      where: {
        memberId: { in: memberIds },
        ...(category ? { categories: { has: category } } : {}),
        ...(city ? { city: { equals: city, mode: "insensitive" } } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { shortDescription: { contains: search, mode: "insensitive" } },
                { fullDescription: { contains: search, mode: "insensitive" } },
                { city: { contains: search, mode: "insensitive" } },
                { address: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        shortDescription: true,
        address: true,
        city: true,
        categories: true,
        logoUrl: true,
        coverPhotoUrl: true,
        phone: true,
        email: true,
        website: true,
        _count: { select: { storeItems: true } },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(
      businesses.map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        shortDescription: b.shortDescription,
        address: b.address,
        city: b.city,
        categories: b.categories,
        logoUrl: b.logoUrl,
        coverPhotoUrl: b.coverPhotoUrl,
        phone: b.phone,
        email: b.email,
        website: b.website,
        itemCount: b._count.storeItems,
      }))
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
