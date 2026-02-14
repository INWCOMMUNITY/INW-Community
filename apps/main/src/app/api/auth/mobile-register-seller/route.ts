/**
 * Mobile app seller registration without Stripe checkout.
 * Creates subscription (seller) + optional business + updates member profile. Used when checkout is bypassed.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const hoursSchema = z.record(z.string()).nullable().optional();
const businessSchema = z.object({
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

const bodySchema = z.object({
  phone: z.string().nullable().optional(),
  deliveryAddress: z
    .object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
    })
    .nullable()
    .optional(),
  business: businessSchema.optional(),
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
    where: { memberId, plan: "seller", status: "active" },
  });
  if (existingSub) {
    return NextResponse.json(
      { error: "You already have an active Seller subscription." },
      { status: 400 }
    );
  }

  try {
    const body = await req.json();
    const data = bodySchema.parse(body);

    // Create subscription (no Stripe - checkout bypassed)
    await prisma.subscription.create({
      data: {
        memberId,
        plan: "seller",
        status: "active",
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year placeholder
      },
    });

    // Create business if provided (sellers can have businesses)
    if (data.business) {
      const b = data.business;
      let slug = slugify(b.name);
      let suffix = 0;
      while (await prisma.business.findUnique({ where: { slug } })) {
        slug = `${slugify(b.name)}-${++suffix}`;
      }
      const business = await prisma.business.create({
        data: {
          memberId,
          name: b.name,
          shortDescription: b.shortDescription ?? null,
          fullDescription: b.fullDescription ?? null,
          website: b.website ?? null,
          phone: b.phone ?? null,
          email: b.email ?? null,
          logoUrl: b.logoUrl?.trim() || null,
          address: b.address ?? null,
          city: b.city ?? null,
          categories: b.categories ?? [],
          slug,
          photos: b.photos ?? [],
          hoursOfOperation: b.hoursOfOperation ?? undefined,
        },
      });
      const { awardBusinessSignupBadges } = await import("@/lib/badge-award");
      awardBusinessSignupBadges(business.id).catch(() => {});
    }

    // Update member profile if provided
    const updates: Prisma.MemberUpdateInput = {};
    if (data.phone !== undefined) {
      updates.phone = data.phone?.trim() || null;
    }
    if (data.deliveryAddress !== undefined && data.deliveryAddress !== null) {
      const addr = data.deliveryAddress;
      const hasAny = addr.street || addr.city || addr.state || addr.zip;
      updates.deliveryAddress = hasAny ? addr : Prisma.JsonNull;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.member.update({
        where: { id: memberId },
        data: updates,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((err) => err.message).join(". ") || "Validation failed";
      return NextResponse.json({ error: msg, details: e.flatten() }, { status: 400 });
    }
    console.error("[mobile-register-seller]", e);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
