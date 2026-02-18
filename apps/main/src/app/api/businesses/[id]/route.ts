import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { validateText, containsProfanity } from "@/lib/content-moderation";
import { createFlaggedContent } from "@/lib/flag-content";
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
  photos: z.array(z.string()).optional(),
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
    photos: business.photos,
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
    const data = bodySchema.parse({
      ...body,
      website: body.website ?? null,
      email: body.email ?? null,
      logoUrl: body.logoUrl ?? null,
    });
    const updateData: Record<string, unknown> = {};
    if (data.name != null && data.name.trim()) {
      const nameCheck = validateText(data.name, "business_name");
      if (!nameCheck.allowed) {
        return NextResponse.json({ error: nameCheck.reason ?? "Invalid business name." }, { status: 400 });
      }
      updateData.name = data.name;
      updateData.nameApprovalStatus = "approved";

      if (containsProfanity(data.name)) {
        await createFlaggedContent({
          contentType: "business",
          contentId: id,
          reason: "profanity",
          snippet: data.name,
          authorId: session.user.id,
        });
      }
    }
    await prisma.business.update({
      where: { id },
      data: {
        ...updateData,
        ...(data.shortDescription !== undefined && { shortDescription: data.shortDescription }),
        ...(data.fullDescription !== undefined && { fullDescription: data.fullDescription }),
        ...(data.website !== undefined && { website: data.website }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
        ...(data.coverPhotoUrl !== undefined && { coverPhotoUrl: data.coverPhotoUrl }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.city !== undefined && { city: data.city }),
        ...(data.categories !== undefined && { categories: data.categories }),
        ...(data.photos !== undefined && { photos: data.photos }),
        ...(data.hoursOfOperation !== undefined && {
          hoursOfOperation: data.hoursOfOperation === null ? Prisma.JsonNull : data.hoursOfOperation,
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
