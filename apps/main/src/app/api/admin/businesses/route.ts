import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const hoursSchema = z.record(z.string()).nullable().optional();
const postSchema = z.object({
  memberId: z.string().min(1, "memberId is required"),
  name: z.string().min(1, "Company name is required"),
  shortDescription: z.string().min(1, "Brief description is required"),
  fullDescription: z.string().min(1, "Full description is required"),
  website: z.string().url().nullable().optional().or(z.literal("")),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  logoUrl: z.string().min(1, "Logo is required"),
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  categories: z.array(z.string().min(1)).min(1).max(2),
  photos: z.array(z.string()).optional(),
  hoursOfOperation: hoursSchema,
});

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const businesses = await prisma.business.findMany({
    select: { id: true, name: true, slug: true, memberId: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(businesses);
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const data = postSchema.parse({
      ...body,
      website: body.website || null,
      email: body.email || null,
      logoUrl: body.logoUrl || null,
    });
    const sub = await prisma.subscription.findFirst({
      where: { memberId: data.memberId, plan: "sponsor", status: "active" },
    });
    if (!sub) {
      return NextResponse.json({ error: "Member must have an active sponsor subscription" }, { status: 400 });
    }
    const count = await prisma.business.count({ where: { memberId: data.memberId } });
    if (count >= 2) {
      return NextResponse.json({ error: "Sponsor already has 2 businesses" }, { status: 400 });
    }
    let slug = slugify(data.name);
    let suffix = 0;
    while (await prisma.business.findUnique({ where: { slug } })) {
      slug = `${slugify(data.name)}-${++suffix}`;
    }
    const business = await prisma.business.create({
      data: {
        memberId: data.memberId,
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
      },
    });
    const { awardBusinessSignupBadges } = await import("@/lib/badge-award");
    awardBusinessSignupBadges(business.id).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((err) => err.message).join(". ") || "Validation failed";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
