import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";

const DEFAULT_POINTS = 5;

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [configs, businessRows, topEarners] = await Promise.all([
    prisma.categoryPointsConfig.findMany({
      orderBy: { category: "asc" },
      select: { category: true, pointsPerScan: true },
    }),
    prisma.business.findMany({
      select: { categories: true },
    }),
    prisma.member.findMany({
      where: { points: { gt: 0 } },
      orderBy: { points: "desc" },
      take: 20,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        points: true,
      },
    }),
  ]);

  const catSet = new Set(businessRows.flatMap((b) => b.categories).filter(Boolean));
  const existingCats = new Set(configs.map((c) => c.category));
  const missingCats = Array.from(catSet).filter((c) => !existingCats.has(c ?? ""));

  return NextResponse.json({
    configs,
    defaultPoints: DEFAULT_POINTS,
    missingCategories: missingCats,
    topEarners,
  });
}

const patchSchema = z.object({
  configs: z.array(
    z.object({
      category: z.string().min(1),
      pointsPerScan: z.number().int().min(0),
    })
  ),
});

export async function PATCH(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const data = patchSchema.parse(body);

    for (const cfg of data.configs) {
      await prisma.categoryPointsConfig.upsert({
        where: { category: cfg.category },
        create: { category: cfg.category, pointsPerScan: cfg.pointsPerScan },
        update: { pointsPerScan: cfg.pointsPerScan },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
