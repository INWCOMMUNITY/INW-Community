import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";


const putSchema = z.object({
  title: z.string().min(1),
  content: z.string(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { slug } = await params;
  const policy = await prisma.policy.findUnique({ where: { slug } });
  if (!policy) return NextResponse.json({ title: slug, content: "" });
  return NextResponse.json(policy);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { slug } = await params;
  try {
    const body = await req.json();
    const data = putSchema.parse(body);
    await prisma.policy.upsert({
      where: { slug },
      create: { slug, title: data.title, content: data.content },
      update: { title: data.title, content: data.content },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
