import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";

// Opt out of static prerender: this route reads query params (businessId) at request time
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_POINTS = 10;

/**
 * GET /api/rewards/scan-preview?businessId=...
 * No auth required. Returns points the user would earn if they scan after logging in.
 * Used by the app to show "Earn X points by logging in or signing up" to guests.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const businessId = url.searchParams.get("businessId")?.trim();
    if (!businessId) {
      return NextResponse.json({ error: "Missing businessId" }, { status: 400 });
    }

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, categories: true },
    });

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    let pointsIfEarned = DEFAULT_POINTS;
    if (business.categories.length > 0) {
      const catConfig = await prisma.categoryPointsConfig.findFirst({
        where: { category: { in: business.categories } },
        orderBy: { pointsPerScan: "desc" },
      });
      if (catConfig) {
        pointsIfEarned = catConfig.pointsPerScan;
      }
    }

    // No 2x for subscriber in preview (we don't have session); they get 2x when they actually scan
    return NextResponse.json({
      requiresAuth: true,
      pointsIfEarned,
      businessName: business.name,
    });
  } catch (e) {
    console.error("[rewards/scan-preview]", e);
    return NextResponse.json({ error: "Preview failed." }, { status: 500 });
  }
}
