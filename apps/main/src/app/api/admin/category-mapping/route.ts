import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getCategoryMappingAnalytics } from "@/lib/channels/category-resolver";
import { prisma } from "database";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/category-mapping
 *
 * Get category mapping statistics and analytics.
 *
 * Query params:
 * - provider: Filter by provider
 * - limit: Number of records (default 100)
 */
export async function GET(req: NextRequest) {
  const isAdmin = await requireAdmin(req);
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const provider = searchParams.get("provider") || undefined;
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") || "100", 10)));

  try {
    const analytics = await getCategoryMappingAnalytics({ provider, limit });

    // Get recent feedback for review
    const recentFeedback = await prisma.categoryMappingFeedback.findMany({
      where: provider ? { provider } : {},
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // Get member info for feedback
    const memberIds = [...new Set(recentFeedback.map((f) => f.memberId))];
    const members = await prisma.member.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const memberMap = new Map(members.map((m) => [m.id, m]));

    const enrichedFeedback = recentFeedback.map((f) => {
      const member = memberMap.get(f.memberId);
      return {
        ...f,
        memberName: member ? `${member.firstName} ${member.lastName}`.trim() : "Unknown",
      };
    });

    // Summary stats
    const totalMappings = analytics.total;
    const highOverrideRate = analytics.stats.filter((s) => s.overrideRate > 0.3).length;
    const lowConfidence = analytics.stats.filter((s) => s.confidence < 0.5).length;

    return NextResponse.json({
      stats: analytics.stats,
      total: analytics.total,
      recentFeedback: enrichedFeedback,
      summary: {
        totalMappings,
        highOverrideRate,
        lowConfidence,
        needsAttention: highOverrideRate + lowConfidence,
      },
    });
  } catch (e) {
    console.error("[admin-category-mapping] error:", e);
    return NextResponse.json(
      { error: "Failed to fetch category mapping data" },
      { status: 500 }
    );
  }
}
