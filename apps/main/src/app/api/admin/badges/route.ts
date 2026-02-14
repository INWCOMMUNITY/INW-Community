import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";

function checkAdmin(req: NextRequest): boolean {
  const code = req.headers.get("x-admin-code");
  const expected = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";
  return code === expected;
}

const createSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  imageUrl: z.string().nullable().optional(),
  category: z.enum(["business", "member", "seller"]),
  criteria: z.unknown().optional(),
  order: z.number().int().optional(),
});

export async function GET(req: NextRequest) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const badges = await prisma.badge.findMany({
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(badges);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const data = createSchema.parse(body);
    const slug = data.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const badge = await prisma.badge.create({
      data: {
        slug,
        name: data.name,
        description: data.description,
        imageUrl: data.imageUrl ?? null,
        category: data.category,
        criteria: data.criteria ?? undefined,
        order: data.order ?? 0,
      },
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
