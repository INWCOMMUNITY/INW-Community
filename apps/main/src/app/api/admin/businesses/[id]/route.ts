import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { wixOriginalMediaUrl } from "@/lib/business-photos";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const business = await prisma.business.findUnique({
    where: { id },
    select: {
      id: true,
      memberId: true,
      name: true,
      nameApprovalStatus: true,
      shortDescription: true,
      fullDescription: true,
      website: true,
      phone: true,
      email: true,
      logoUrl: true,
      address: true,
      city: true,
      categories: true,
      photos: true,
      hoursOfOperation: true,
      member: { select: { firstName: true, lastName: true, email: true } },
    },
  });
  if (!business) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { member, ...rest } = business;
  return NextResponse.json({
    ...rest,
    logoUrl: business.logoUrl ? wixOriginalMediaUrl(business.logoUrl) : null,
    photos: (business.photos ?? []).map((p) => wixOriginalMediaUrl(p)),
    owner: member
      ? {
          firstName: member.firstName,
          lastName: member.lastName,
          email: member.email,
        }
      : null,
  });
}

const hoursSchema = z.record(z.string()).nullable().optional();
const bodySchema = z.object({
  memberId: z.string().min(1).optional(), // Reassign owner; when set, also set adminGrantedAt so new owner gets free Business Hub access
  nameApprovalStatus: z.enum(["approved", "rejected"]).optional(),
  name: z.string().min(1).optional(),
  shortDescription: z.string().nullable().optional(),
  fullDescription: z.string().nullable().optional(),
  website: z.string().nullable().optional().transform((v) => v || null),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional().transform((v) => v || null),
  logoUrl: z.string().nullable().optional().transform((v) => v || null),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  categories: z.array(z.string()).max(2).optional(),
  photos: z.array(z.string()).optional(),
  hoursOfOperation: hoursSchema,
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let data: z.infer<typeof bodySchema>;
  try {
    // Do not coerce omitted logoUrl/website/email to null — that cleared media when
    // the client sent only memberId (transfer) or another partial PATCH.
    data = bodySchema.parse({
      ...(body as Record<string, unknown>),
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((err) => err.message).join(". ") || "Validation failed";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  const existing = await prisma.business.findUnique({ where: { id }, select: { id: true, memberId: true } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {
    ...(data.nameApprovalStatus != null && { nameApprovalStatus: data.nameApprovalStatus }),
    ...(data.name != null && { name: data.name }),
    ...(data.shortDescription !== undefined && { shortDescription: data.shortDescription }),
    ...(data.fullDescription !== undefined && { fullDescription: data.fullDescription }),
    ...(data.website !== undefined && { website: data.website }),
    ...(data.phone !== undefined && { phone: data.phone }),
    ...(data.email !== undefined && { email: data.email }),
    ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
    ...(data.address !== undefined && { address: data.address }),
    ...(data.city !== undefined && { city: data.city }),
    ...(data.categories !== undefined && { categories: data.categories }),
    ...(data.photos !== undefined && { photos: data.photos }),
    ...(data.hoursOfOperation !== undefined && {
      hoursOfOperation: data.hoursOfOperation === null ? Prisma.JsonNull : data.hoursOfOperation,
    }),
  };
  if (data.memberId != null && data.memberId !== existing.memberId) {
    updateData.memberId = data.memberId;
    updateData.adminGrantedAt = new Date();
  }

  try {
    await prisma.business.update({
      where: { id },
      data: updateData as Parameters<typeof prisma.business.update>[0]["data"],
    });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("[PATCH /api/admin/businesses/[id]]", err);
    const message =
      process.env.NODE_ENV === "development" ? err.message || "Update failed" : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await prisma.business.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
