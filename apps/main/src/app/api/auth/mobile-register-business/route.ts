/**
 * Mobile app business registration without Stripe checkout.
 * Creates subscription (sponsor) + business. Used when checkout is bypassed.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const hoursSchema = z.record(z.string()).nullable().optional();
const bodySchema = z.object({
  name: z.string().min(1, "Company name is required"),
  shortDescription: z.string().min(1, "Brief description is required"),
  fullDescription: z.string().min(1, "Full description is required"),
  website: z.string().url().nullable().optional().or(z.literal("")),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  logoUrl: z.string().nullable().optional().or(z.literal("")),
  address: z.string().nullable().optional().transform((v) => v?.trim() || null),
  city: z.string().min(1, "City is required"),
  categories: z
    .array(z.string().min(1))
    .min(1, "At least one category is required")
    .max(2, "Maximum 2 categories"),
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

  const memberId = session.user.id;

  // Avoid duplicate subscriptions
  const existingSub = await prisma.subscription.findFirst({
    where: { memberId, plan: "sponsor", status: "active" },
  });
  if (existingSub) {
    return NextResponse.json(
      { error: "You already have an active Business subscription." },
      { status: 400 }
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

    // Create subscription (no Stripe - checkout bypassed)
    await prisma.subscription.create({
      data: {
        memberId,
        plan: "sponsor",
        status: "active",
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year placeholder
      },
    });

    // Create business
    let slug = slugify(data.name);
    let suffix = 0;
    while (await prisma.business.findUnique({ where: { slug } })) {
      slug = `${slugify(data.name)}-${++suffix}`;
    }

    const business = await prisma.business.create({
      data: {
        memberId,
        name: data.name,
        shortDescription: data.shortDescription ?? null,
        fullDescription: data.fullDescription ?? null,
        website: data.website ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        logoUrl: data.logoUrl?.trim() || null,
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
      return NextResponse.json({ error: msg, details: e.flatten() }, { status: 400 });
    }
    console.error("[mobile-register-business]", e);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
