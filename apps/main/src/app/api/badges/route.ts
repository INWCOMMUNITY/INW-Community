import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";

/**
 * GET /api/badges
 * Returns all badges for the Community Badges page.
 */
export async function GET(_req: NextRequest) {
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
