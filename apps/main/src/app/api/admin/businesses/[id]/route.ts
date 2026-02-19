import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";

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
    },
  });
  if (!business) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(business);
}

const hoursSchema = z.record(z.string()).nullable().optional();
const bodySchema = z.object({
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
  try {
    const body = await req.json();
    const data = bodySchema.parse({
      ...body,
      website: body.website ?? null,
      email: body.email ?? null,
      logoUrl: body.logoUrl ?? null,
    });
    await prisma.business.update({
      where: { id },
      data: {
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
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((err) => err.message).join(". ") || "Validation failed";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
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
