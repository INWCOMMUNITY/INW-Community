import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";

const bodySchema = z.object({
  status: z.enum(["pending", "approved"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const body = await req.json();
    const { status } = bodySchema.parse(body);
    const existing = await prisma.blog.findUnique({
      where: { id },
      select: { id: true, status: true, memberId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await prisma.blog.update({
      where: { id },
      data: { status },
    });
    let earnedBadges: { slug: string; name: string; description: string }[] = [];
    if (status === "approved" && existing.status === "pending") {
      try {
        const { awardCommunityWriterBadge } = await import("@/lib/badge-award");
        earnedBadges = await awardCommunityWriterBadge(existing.memberId);
      } catch {
        /* best-effort */
      }
    }
    return NextResponse.json({
      ok: true,
      ...(earnedBadges.length > 0 ? { earnedBadges } : {}),
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(_req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    await prisma.blog.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
