import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "database";
import {
  businessDisplayCityEquals,
  deduplicateCities,
  extractBusinessDisplayCity,
} from "@/lib/city-utils";
import { couponPublicActiveWhere } from "@/lib/coupon-expiration";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const list = searchParams.get("list");
  if (list === "meta") {
    const coupons = await prisma.coupon.findMany({
      where: couponPublicActiveWhere(),
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

  const andParts: Prisma.CouponWhereInput[] = [couponPublicActiveWhere()];
  if (category) {
    andParts.push({ business: { categories: { has: category } } });
  }
  if (search) {
    andParts.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { discount: { contains: search, mode: "insensitive" } },
        { business: { name: { contains: search, mode: "insensitive" } } },
      ],
    });
  }
  const where: Prisma.CouponWhereInput =
    andParts.length === 1 ? andParts[0]! : { AND: andParts };

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
