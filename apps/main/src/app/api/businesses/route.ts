import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import {
  businessDisplayCityEquals,
  deduplicateCities,
  extractBusinessDisplayCity,
  normalizeResidentCity,
} from "@/lib/city-utils";
import { getSessionForApi } from "@/lib/mobile-auth";
import { validateText, containsProfanity } from "@/lib/content-moderation";
import { createFlaggedContent } from "@/lib/flag-content";
import {
  businessMatchesCategoryAndSub,
  normalizeSubcategoriesByPrimary,
  parseSubcategoriesByPrimary,
} from "@/lib/business-categories";
import { z } from "zod";
import { NWC_PAID_PLAN_ACCESS_STATUSES, prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import { hasBusinessHubAccess } from "@/lib/business-hub-access";
import { linkAllUnscopedStoreItemsToBusiness } from "@/lib/migrate-resale-items-for-seller-plan";
import { photosExcludingLogo } from "@/lib/business-photos";
import { isCouponActiveByExpiresAt } from "@/lib/coupon-expiration";

export async function GET(req: NextRequest) {
  try {
  const searchParams = req.nextUrl.searchParams;

  const mine = searchParams.get("mine");
  if (mine === "1") {
    const session = await getSessionForApi(req);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasBusinessHubAccess(session.user.id))) {
      return NextResponse.json({ error: "Business Hub access required" }, { status: 403 });
    }
    const businesses = await prisma.business.findMany({
      where: { memberId: session.user.id },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        coverPhotoUrl: true,
        photos: true,
      },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(businesses);
  }

  // Public directory: owner has active Business (sponsor) or Seller subscription, OR listing was
  // admin-assigned (adminGrantedAt) — e.g. imported/restored businesses without a paid sub on the owner.
  const activeSubs = await prisma.subscription.findMany({
    where: { plan: { in: ["sponsor", "seller"] }, status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] } },
    select: { memberId: true },
  });
  const activeMemberIds = activeSubs.map((s) => s.memberId);

  const publicDirectoryBase = {
    nameApprovalStatus: "approved" as const,
    OR: [
      ...(activeMemberIds.length > 0 ? [{ memberId: { in: activeMemberIds } }] : []),
      { adminGrantedAt: { not: null } },
    ],
  };

  const slug = searchParams.get("slug")?.trim();
  if (slug) {
    const business = await prisma.business.findFirst({
      where: { slug, ...publicDirectoryBase },
      include: { coupons: true },
    });
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
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
      address: business.address,
      city: extractBusinessDisplayCity(business.city) ?? business.city,
      categories: business.categories,
      subcategoriesByPrimary: parseSubcategoriesByPrimary(business.subcategoriesByPrimary),
      hoursOfOperation: business.hoursOfOperation,
      photos: photosExcludingLogo(business.photos, business.logoUrl),
      coupons: business.coupons.filter((c) => isCouponActiveByExpiresAt(c.expiresAt)),
    });
  }

  const list = searchParams.get("list");
  if (list === "meta") {
    const [businessRows, cityRows] = await Promise.all([
      prisma.business.findMany({ where: publicDirectoryBase, select: { categories: true, subcategoriesByPrimary: true } }),
      prisma.business.findMany({
        where: { AND: [publicDirectoryBase, { city: { not: null } }] },
        select: { city: true },
      }),
    ]);
    const primarySet = new Set<string>();
    const subByPrimary = new Map<string, Set<string>>();
    for (const b of businessRows) {
      const cats = b.categories ?? [];
      const map = parseSubcategoriesByPrimary(b.subcategoriesByPrimary);
      for (const c of cats) {
        const p = c?.trim();
        if (!p) continue;
        primarySet.add(p);
        const list = map[p] ?? [];
        for (const su of list) {
          const t = su.trim();
          if (!t) continue;
          if (!subByPrimary.has(p)) subByPrimary.set(p, new Set());
          subByPrimary.get(p)!.add(t);
        }
      }
    }
    const cities = deduplicateCities(cityRows.map((c) => c.city));
    return NextResponse.json({
      categories: Array.from(primarySet).sort(),
      subcategoriesByPrimary: Object.fromEntries(
        [...subByPrimary.entries()].map(([k, v]) => [k, Array.from(v).sort()])
      ),
      cities,
    });
  }
  const category = searchParams.get("category")?.trim() || "";
  const subcategory = searchParams.get("subcategory")?.trim() || "";
  const cityFilter = (searchParams.get("city") ?? "").trim();
  const search = searchParams.get("search")?.trim();
  const businesses = await prisma.business.findMany({
    where: {
      AND: [
        publicDirectoryBase,
        ...(category ? [{ categories: { has: category } }] : []),
        ...(search
          ? [
              {
                OR: [
                  { name: { contains: search, mode: "insensitive" as const } },
                  { shortDescription: { contains: search, mode: "insensitive" as const } },
                  { fullDescription: { contains: search, mode: "insensitive" as const } },
                  { city: { contains: search, mode: "insensitive" as const } },
                  { address: { contains: search, mode: "insensitive" as const } },
                ],
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      shortDescription: true,
      address: true,
      city: true,
      categories: true,
      subcategoriesByPrimary: true,
      logoUrl: true,
      hoursOfOperation: true,
    },
    orderBy: { name: "asc" },
  });
  let resultRows = businesses;
  // Subcategory only narrows results within the selected primary; it is never required to get directory matches.
  if (category && subcategory) {
    resultRows = resultRows.filter((b) =>
      businessMatchesCategoryAndSub(b.categories, b.subcategoriesByPrimary, category, subcategory)
    );
  }
  if (cityFilter) {
    resultRows = resultRows.filter((b) => businessDisplayCityEquals(b.city, cityFilter));
  }
  return NextResponse.json(
    resultRows.map((b) => ({
      ...b,
      city: extractBusinessDisplayCity(b.city) ?? b.city,
    }))
  );
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (process.env.NODE_ENV === "development") {
      console.error("[api/businesses]", err);
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

const hoursSchema = z.record(z.string()).nullable().optional();
const bodySchema = z.object({
  name: z.string().min(1, "Company name is required"),
  shortDescription: z.string().min(1, "Brief description is required"),
  fullDescription: z.string().min(1, "Full description is required"),
  website: z.string().url().nullable().optional().or(z.literal("")),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  logoUrl: z.string().min(1, "Logo is required"),
  address: z.string().nullable().optional().transform((v) => v?.trim() || null),
  city: z.string().min(1, "City is required"),
  categories: z.array(z.string().min(1)).min(1, "At least one category is required").max(2, "Maximum 2 categories"),
  subcategoriesByPrimary: z.record(z.array(z.string())).optional(),
  photos: z.array(z.string()).max(12, "Maximum 12 gallery photos").optional(),
  hoursOfOperation: hoursSchema,
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await hasBusinessHubAccess(session.user.id))) {
    return NextResponse.json({ error: "Business Hub access required" }, { status: 403 });
  }
  const existingCount = await prisma.business.count({
    where: { memberId: session.user.id },
  });
  if (existingCount >= 2) {
    return NextResponse.json(
      {
        error:
          "Maximum 2 businesses per Business Hub account. Edit an existing business or delete one to add another.",
      },
      { status: 403 }
    );
  }
  try {
    const body = await req.json();
    const parsed = bodySchema.parse({
      ...body,
      website: body.website || null,
      email: body.email || null,
      logoUrl: body.logoUrl || null,
    });
    const data = {
      ...parsed,
      subcategoriesByPrimary: normalizeSubcategoriesByPrimary(
        parsed.categories,
        parsed.subcategoriesByPrimary
      ),
    };
    const nameCheck = validateText(data.name, "business_name");
    if (!nameCheck.allowed) {
      return NextResponse.json({ error: nameCheck.reason ?? "Invalid business name." }, { status: 400 });
    }
    // Auto-approve; flag if profanity for admin review
    const hasProfanity = containsProfanity(data.name);
    let slug = slugify(data.name);
    let suffix = 0;
    while (await prisma.business.findUnique({ where: { slug } })) {
      slug = `${slugify(data.name)}-${++suffix}`;
    }
    const isFirstBusiness = existingCount === 0;

    const cityStored = normalizeResidentCity(data.city.trim());

    const business = await prisma.business.create({
      data: {
        memberId: session.user.id,
        name: data.name,
        shortDescription: data.shortDescription ?? null,
        fullDescription: data.fullDescription ?? null,
        website: data.website ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        logoUrl: data.logoUrl ?? null,
        address: data.address ?? null,
        city: cityStored,
        categories: data.categories ?? [],
        subcategoriesByPrimary: data.subcategoriesByPrimary,
        slug,
        photos: data.photos ?? [],
        hoursOfOperation: data.hoursOfOperation ?? undefined,
        nameApprovalStatus: "approved",
      },
    });

    if (hasProfanity) {
      await createFlaggedContent({
        contentType: "business",
        contentId: business.id,
        reason: "profanity",
        snippet: data.name,
        authorId: session.user.id,
      });
    }
    if (isFirstBusiness) {
      const sellerPlan = await prisma.subscription.findFirst({
        where: prismaWhereMemberSellerPlanAccess(session.user.id),
      });
      if (sellerPlan) {
        await linkAllUnscopedStoreItemsToBusiness(session.user.id, business.id);
      }
    }
    const { awardBusinessSignupBadges } = await import("@/lib/badge-award");
    let earnedBadges: { slug: string; name: string; description: string }[] = [];
    try {
      earnedBadges = await awardBusinessSignupBadges(business.id);
    } catch {
      /* badge errors shouldn't block business create */
    }
    return NextResponse.json({ ok: true, earnedBadges });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((err) => err.message).join(". ") || "Validation failed";
      return NextResponse.json({ error: msg, details: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
