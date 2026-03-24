import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { validateText, containsProfanity } from "@/lib/content-moderation";
import { createFlaggedContent } from "@/lib/flag-content";
import { normalizeSubcategoriesByPrimary, parseSubcategoriesByPrimary } from "@/lib/business-categories";
import { photosExcludingLogo } from "@/lib/business-photos";
import { z } from "zod";

const hoursSchema = z.record(z.string()).nullable().optional();
const bodySchema = z.object({
  name: z.string().min(1).optional(),
  shortDescription: z.string().nullable().optional(),
  fullDescription: z.string().nullable().optional(),
  website: z.string().nullable().optional().transform((v) => v || null),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional().transform((v) => v || null),
  logoUrl: z.string().nullable().optional().transform((v) => v || null),
  coverPhotoUrl: z.string().nullable().optional().transform((v) => v || null),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  categories: z.array(z.string()).max(2).optional(),
  subcategoriesByPrimary: z.record(z.array(z.string())).optional(),
  photos: z.array(z.string()).max(12, "Maximum 12 gallery photos").optional(),
  hoursOfOperation: hoursSchema,
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const business = await prisma.business.findFirst({
    where: { id, memberId: session.user.id },
  });
  if (!business) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
    coverPhotoUrl: business.coverPhotoUrl,
    address: business.address,
    city: business.city,
    categories: business.categories,
    subcategoriesByPrimary: parseSubcategoriesByPrimary(business.subcategoriesByPrimary),
    photos: photosExcludingLogo(business.photos, business.logoUrl),
    hoursOfOperation: business.hoursOfOperation,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const business = await prisma.business.findFirst({
    where: { id, memberId: session.user.id },
  });
  if (!business) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const body = await req.json();
    const parsed = bodySchema.parse({
      ...body,
      website: body.website ?? null,
      email: body.email ?? null,
      logoUrl: body.logoUrl ?? null,
    });
    const updateData: Record<string, unknown> = {};
    if (parsed.name != null && parsed.name.trim()) {
      const nameCheck = validateText(parsed.name, "business_name");
      if (!nameCheck.allowed) {
        return NextResponse.json({ error: nameCheck.reason ?? "Invalid business name." }, { status: 400 });
      }
      updateData.name = parsed.name;
      updateData.nameApprovalStatus = "approved";

      if (containsProfanity(parsed.name)) {
        await createFlaggedContent({
          contentType: "business",
          contentId: id,
          reason: "profanity",
          snippet: parsed.name,
          authorId: session.user.id,
        });
      }
    }
    await prisma.business.update({
      where: { id },
      data: {
        ...updateData,
        ...(parsed.shortDescription !== undefined && { shortDescription: parsed.shortDescription }),
        ...(parsed.fullDescription !== undefined && { fullDescription: parsed.fullDescription }),
        ...(parsed.website !== undefined && { website: parsed.website }),
        ...(parsed.phone !== undefined && { phone: parsed.phone }),
        ...(parsed.email !== undefined && { email: parsed.email }),
        ...(parsed.logoUrl !== undefined && { logoUrl: parsed.logoUrl }),
        ...(parsed.coverPhotoUrl !== undefined && { coverPhotoUrl: parsed.coverPhotoUrl }),
        ...(parsed.address !== undefined && { address: parsed.address }),
        ...(parsed.city !== undefined && { city: parsed.city }),
        ...(parsed.categories !== undefined && { categories: parsed.categories }),
        ...((parsed.categories !== undefined || parsed.subcategoriesByPrimary !== undefined) && {
          subcategoriesByPrimary: normalizeSubcategoriesByPrimary(
            parsed.categories ?? business.categories,
            parsed.subcategoriesByPrimary !== undefined
              ? parsed.subcategoriesByPrimary
              : business.subcategoriesByPrimary
          ),
        }),
        ...(parsed.photos !== undefined && { photos: parsed.photos }),
        ...(parsed.hoursOfOperation !== undefined && {
          hoursOfOperation: parsed.hoursOfOperation === null ? Prisma.JsonNull : parsed.hoursOfOperation,
        }),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((err) => err.message).join(". ") || "Validation failed";
      return NextResponse.json({ error: msg, details: e.flatten() }, { status: 400 });
    }
    const message = e instanceof Error ? e.message : "Failed to update";
    console.error("[PATCH /api/businesses/[id]]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const business = await prisma.business.findFirst({
    where: { id, memberId: session.user.id },
  });
  if (!business) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.business.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
