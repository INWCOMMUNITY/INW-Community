import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { deduplicateCities } from "@/lib/city-utils";
import { getSessionForApi } from "@/lib/mobile-auth";
import { validateText, containsProfanity } from "@/lib/content-moderation";
import { createFlaggedContent } from "@/lib/flag-content";
import { z } from "zod";

export async function GET(req: NextRequest) {
  try {
  const searchParams = req.nextUrl.searchParams;
  const slug = searchParams.get("slug")?.trim();
  if (slug) {
    const business = await prisma.business.findFirst({
      where: { slug, nameApprovalStatus: "approved" },
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
      city: business.city,
      categories: business.categories,
      hoursOfOperation: business.hoursOfOperation,
      photos: business.photos,
      coupons: business.coupons,
    });
  }
  const list = searchParams.get("list");
  const mine = searchParams.get("mine");
  if (mine === "1") {
    const session = await getSessionForApi(req);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const sub = await prisma.subscription.findFirst({
      where: { memberId: session.user.id, plan: { in: ["sponsor", "seller"] }, status: "active" },
    });
    if (!sub) {
      return NextResponse.json({ error: "Sponsor or Seller plan required" }, { status: 403 });
    }
    const businesses = await prisma.business.findMany({
      where: { memberId: session.user.id },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(businesses);
  }
  if (list === "meta") {
    const [businesses, cityRows] = await Promise.all([
      prisma.business.findMany({ where: { nameApprovalStatus: "approved" }, select: { categories: true } }),
      prisma.business.findMany({
        where: { nameApprovalStatus: "approved", city: { not: null } },
        select: { city: true },
      }),
    ]);
    const catSet = new Set(businesses.flatMap((b) => (b.categories ?? []).filter(Boolean)));
    const cities = deduplicateCities(cityRows.map((c) => c.city));
    return NextResponse.json({
      categories: Array.from(catSet).sort(),
      cities,
    });
  }
  const category = searchParams.get("category");
  const city = searchParams.get("city");
  const search = searchParams.get("search")?.trim();
  const businesses = await prisma.business.findMany({
    where: {
      nameApprovalStatus: "approved",
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
      hoursOfOperation: true,
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(businesses);
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
  photos: z.array(z.string()).optional(),
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
  const sub = await prisma.subscription.findFirst({
    where: { memberId: session.user.id, plan: { in: ["sponsor", "seller"] }, status: "active" },
  });
  if (!sub) {
    return NextResponse.json({ error: "Sponsor or Seller plan required" }, { status: 403 });
  }
  const existingCount = await prisma.business.count({
    where: { memberId: session.user.id },
  });
  if (existingCount >= 2) {
    return NextResponse.json(
      { error: "Maximum 2 businesses per sponsor. Edit an existing business or delete one to add another." },
      { status: 403 }
    );
  }
  try {
    const body = await req.json();
    const data = bodySchema.parse({
      ...body,
      website: body.website || null,
      email: body.email || null,
      logoUrl: body.logoUrl || null,
    });
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
        city: data.city ?? null,
        categories: data.categories ?? [],
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
    const { awardBusinessSignupBadges } = await import("@/lib/badge-award");
    awardBusinessSignupBadges(business.id).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((err) => err.message).join(". ") || "Validation failed";
      return NextResponse.json({ error: msg, details: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
