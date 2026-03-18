import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";
import { z } from "zod";

const patchSchema = z.object({
  seasonId: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const body = await req.json();
    const data = patchSchema.parse(body);
    const seasonId = data.seasonId === null || data.seasonId === "" ? null : data.seasonId;
    if (seasonId) {
      const season = await prisma.season.findUnique({ where: { id: seasonId } });
      if (!season) return NextResponse.json({ error: "Season not found" }, { status: 404 });
    }
    await prisma.reward.update({
      where: { id },
      data: { seasonId },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
