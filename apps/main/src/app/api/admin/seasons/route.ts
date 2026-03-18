import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const seasons = await prisma.season.findMany({
    orderBy: { startDate: "desc" },
  });
  return NextResponse.json(
    seasons.map((s) => ({
      id: s.id,
      name: s.name,
      startDate: s.startDate.toISOString().slice(0, 10),
      endDate: s.endDate.toISOString().slice(0, 10),
    }))
  );
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const data = createSchema.parse(body);
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (end < start) {
      return NextResponse.json({ error: "End date must be on or after start date" }, { status: 400 });
    }
    const season = await prisma.season.create({
      data: {
        name: data.name.trim(),
        startDate: start,
        endDate: end,
      },
    });
    return NextResponse.json({
      id: season.id,
      name: season.name,
      startDate: season.startDate.toISOString().slice(0, 10),
      endDate: season.endDate.toISOString().slice(0, 10),
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
