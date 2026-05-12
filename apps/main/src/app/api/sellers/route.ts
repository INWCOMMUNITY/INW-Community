import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import {
  businessDisplayCityEquals,
  deduplicateCities,
  extractBusinessDisplayCity,
} from "@/lib/city-utils";
import { businessMatchesCategoryAndSub, parseSubcategoriesByPrimary } from "@/lib/business-categories";
import { NWC_PAID_PLAN_ACCESS_STATUSES } from "@/lib/nwc-paid-subscription";
import {
  buildBusinessDirectorySearchWhere,
  computeDirectorySearchMatchNote,
  normalizeSearchForMatching,
  sortByDirectorySearchRelevance,
  splitSearchQueryWithImpliedCity,
} from "@/lib/business-directory-search";

/**
 * GET /api/sellers
 * List seller storefronts (businesses whose member has seller plan).
 * Query params: search, category, city
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl?.searchParams ?? new URLSearchParams();
    const list = searchParams.get("list");
    const category = searchParams.get("category")?.trim() || "";

    const sellerMemberIds = await prisma.subscription.findMany({
      where: { plan: "seller", status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] } },
      select: { memberId: true },
    });
    const memberIds = sellerMemberIds.map((s) => s.memberId);
    if (memberIds.length === 0) {
      if (list === "meta") {
        return NextResponse.json({ categories: [], subcategoriesByPrimary: {}, cities: [] });
      }
      return NextResponse.json([]);
    }

    if (list === "meta") {
      const sellerBusinesses = await prisma.business.findMany({
        where: { memberId: { in: memberIds } },
        select: { categories: true, subcategoriesByPrimary: true, city: true },
      });
      const primarySet = new Set<string>();
      const subByPrimary = new Map<string, Set<string>>();
      for (const b of sellerBusinesses) {
        const cats = b.categories ?? [];
        const map = parseSubcategoriesByPrimary(b.subcategoriesByPrimary);
        for (const c of cats) {
          const p = c?.trim();
          if (!p) continue;
          primarySet.add(p);
          for (const su of map[p] ?? []) {
            const t = su.trim();
            if (!t) continue;
            if (!subByPrimary.has(p)) subByPrimary.set(p, new Set());
            subByPrimary.get(p)!.add(t);
          }
        }
      }
      const cities = deduplicateCities(sellerBusinesses.map((c) => c.city));
      return NextResponse.json({
        categories: Array.from(primarySet).sort(),
        subcategoriesByPrimary: Object.fromEntries(
          [...subByPrimary.entries()].map(([k, v]) => [k, Array.from(v).sort()])
        ),
        cities,
      });
    }

    const subcategory = searchParams.get("subcategory")?.trim() || "";

    let cityFilter = (searchParams.get("city") ?? "").trim();
    const searchRaw = searchParams.get("search")?.trim() ?? "";
    let effectiveSearch = searchRaw;
    if (searchRaw && !cityFilter) {
      const sellerCityRows = await prisma.business.findMany({
        where: { memberId: { in: memberIds }, city: { not: null } },
        select: { city: true },
      });
      const directoryCities = deduplicateCities(sellerCityRows.map((c) => c.city));
      const split = splitSearchQueryWithImpliedCity(searchRaw, directoryCities);
      if (split.impliedCity) {
        cityFilter = split.impliedCity;
        effectiveSearch = split.textSearch;
      }
    }

    const searchWhere = buildBusinessDirectorySearchWhere(effectiveSearch);

    // Subcategory only narrows within the selected primary (see /api/businesses).
    const businesses = await prisma.business.findMany({
      where: {
        memberId: { in: memberIds },
        ...(category ? { categories: { has: category } } : {}),
        ...(searchWhere ? searchWhere : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        shortDescription: true,
        fullDescription: true,
        address: true,
        city: true,
        categories: true,
        subcategoriesByPrimary: true,
        logoUrl: true,
        coverPhotoUrl: true,
        phone: true,
        email: true,
        website: true,
        _count: { select: { storeItems: true } },
      },
      orderBy: { name: "asc" },
    });

    let sellerRows = businesses;
    if (category && subcategory) {
      sellerRows = sellerRows.filter((b) =>
        businessMatchesCategoryAndSub(b.categories, b.subcategoriesByPrimary, category, subcategory)
      );
    }
    if (cityFilter) {
      sellerRows = sellerRows.filter((b) => businessDisplayCityEquals(b.city, cityFilter));
    }

    if (normalizeSearchForMatching(effectiveSearch).length > 0) {
      sellerRows = sortByDirectorySearchRelevance(sellerRows, effectiveSearch);
    }

    return NextResponse.json(
      sellerRows.map((b) => {
        const { fullDescription, ...rest } = b;
        const note =
          normalizeSearchForMatching(effectiveSearch).length > 0
            ? computeDirectorySearchMatchNote(
                {
                  name: b.name,
                  shortDescription: b.shortDescription,
                  fullDescription: b.fullDescription,
                  city: b.city,
                  address: b.address,
                  categories: b.categories,
                  subcategoriesByPrimary: b.subcategoriesByPrimary,
                },
                effectiveSearch
              )
            : undefined;
        const row = {
          id: rest.id,
          name: rest.name,
          slug: rest.slug,
          shortDescription: rest.shortDescription,
          address: rest.address,
          city: extractBusinessDisplayCity(rest.city) ?? rest.city,
          categories: rest.categories,
          subcategoriesByPrimary: parseSubcategoriesByPrimary(rest.subcategoriesByPrimary),
          logoUrl: rest.logoUrl,
          coverPhotoUrl: rest.coverPhotoUrl,
          phone: rest.phone,
          email: rest.email,
          website: rest.website,
          itemCount: rest._count.storeItems,
        };
        return note ? { ...row, directorySearchMatchNote: note } : row;
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
