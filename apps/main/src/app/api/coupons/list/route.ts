import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "database";
import {
  businessDisplayCityEquals,
  deduplicateCities,
  extractBusinessDisplayCity,
} from "@/lib/city-utils";

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
  const cityFilter = (searchParams.get("city") ?? "").trim();
  const search = searchParams.get("search")?.trim();

  const where: Prisma.CouponWhereInput = {};
  if (category) {
    where.business = {
      categories: { has: category },
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
  let rows = coupons;
  if (cityFilter) {
    rows = rows.filter((c) => businessDisplayCityEquals(c.business?.city, cityFilter));
  }
  return NextResponse.json(
    rows.map((c) => ({
      ...c,
      business: c.business
        ? {
            ...c.business,
            city: extractBusinessDisplayCity(c.business.city) ?? c.business.city,
          }
        : c.business,
    }))
  );
}
