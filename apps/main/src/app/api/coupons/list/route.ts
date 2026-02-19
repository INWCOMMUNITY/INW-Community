import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "database";
import { deduplicateCities } from "@/lib/city-utils";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const list = searchParams.get("list");
  if (list === "meta") {
    const coupons = await prisma.coupon.findMany({
      include: { business: { select: { city: true, categories: true } } },
    });
    const cityList: string[] = [];
    const categories = new Set<string>();
    coupons.forEach((c) => {
      if (c.business?.city) cityList.push(c.business.city);
      (c.business?.categories ?? []).forEach((cat) => categories.add(cat));
    });
    return NextResponse.json({
      categories: Array.from(categories).sort(),
      cities: deduplicateCities(cityList),
    });
  }
  const category = searchParams.get("category");
  const city = searchParams.get("city");
  const search = searchParams.get("search")?.trim();

  const where: Prisma.CouponWhereInput = {};
  if (category || city) {
    where.business = {
      ...(category ? { categories: { has: category } } : {}),
      ...(city ? { city: { equals: city, mode: "insensitive" } } : {}),
    };
  }
  if (search) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { discount: { contains: search, mode: "insensitive" } },
          { business: { name: { contains: search, mode: "insensitive" } } },
        ],
      },
    ];
  }

  const coupons = await prisma.coupon.findMany({
    where,
    include: {
      business: { select: { name: true, city: true, categories: true, logoUrl: true } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(coupons);
}
