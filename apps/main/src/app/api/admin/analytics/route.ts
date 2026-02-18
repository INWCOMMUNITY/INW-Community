import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      pageviewsToday,
      pageviewsWeek,
      appOpensToday,
      appOpensWeek,
      appOpensBySource,
      webVitalsRecent,
      healthDb,
    ] = await Promise.all([
      prisma.analyticsEvent.count({
        where: { event: "pageview", createdAt: { gte: dayAgo } },
      }),
      prisma.analyticsEvent.count({
        where: { event: "pageview", createdAt: { gte: weekAgo } },
      }),
      prisma.analyticsEvent.count({
        where: { event: "app_open", createdAt: { gte: dayAgo } },
      }),
      prisma.analyticsEvent.count({
        where: { event: "app_open", createdAt: { gte: weekAgo } },
      }),
      prisma.analyticsEvent.groupBy({
        by: ["source"],
        where: { event: "app_open", createdAt: { gte: weekAgo } },
        _count: { id: true },
      }),
      prisma.analyticsEvent.findMany({
        where: { event: "web_vitals", createdAt: { gte: weekAgo } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.$queryRaw`SELECT 1`.catch(() => null),
    ]);

    const lcpValues = webVitalsRecent.filter((e) => e.name === "LCP" && e.value != null).map((e) => e.value!);
    const fidValues = webVitalsRecent.filter((e) => e.name === "FID" && e.value != null).map((e) => e.value!);
    const clsValues = webVitalsRecent.filter((e) => e.name === "CLS" && e.value != null).map((e) => e.value!);

    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

    const health = {
      database: healthDb != null,
      stripe: !!process.env.STRIPE_SECRET_KEY,
    };

    return NextResponse.json({
      pageviewsToday,
      pageviewsWeek,
      appOpensToday,
      appOpensWeek,
      appOpensBySource: appOpensBySource.reduce((acc, x) => ({ ...acc, [x.source]: x._count.id }), {} as Record<string, number>),
      webVitals: {
        lcp: avg(lcpValues),
        fid: avg(fidValues),
        cls: avg(clsValues),
        sampleCount: webVitalsRecent.length,
      },
      health,
    });
  } catch (e) {
    console.error("[admin/analytics]", e);
    return NextResponse.json(
      {
        pageviewsToday: 0,
        pageviewsWeek: 0,
        appOpensToday: 0,
        appOpensWeek: 0,
        appOpensBySource: {},
        webVitals: { lcp: null, fid: null, cls: null, sampleCount: 0 },
        health: { database: false, stripe: false },
      },
      { status: 200 }
    );
  }
}
