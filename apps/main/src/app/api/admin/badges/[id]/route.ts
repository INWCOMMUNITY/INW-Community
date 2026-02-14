import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";

function checkAdmin(req: NextRequest): boolean {
  const code = req.headers.get("x-admin-code");
  const expected = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";
  return code === expected;
}

const updateSchema = z.object({
  slug: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  imageUrl: z.string().nullable().optional(),
  category: z.enum(["business", "member", "seller"]).optional(),
  criteria: z.unknown().optional(),
  order: z.number().int().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const body = await req.json();
    const data = updateSchema.parse(body);
    const update: Record<string, unknown> = {};
    if (data.slug !== undefined) update.slug = data.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.imageUrl !== undefined) update.imageUrl = data.imageUrl;
    if (data.category !== undefined) update.category = data.category;
    if (data.criteria !== undefined) update.criteria = data.criteria;
    if (data.order !== undefined) update.order = data.order;
    const badge = await prisma.badge.update({
      where: { id },
      data: update as object,
    });
    return NextResponse.json(badge);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: e.errors[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    await prisma.badge.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
