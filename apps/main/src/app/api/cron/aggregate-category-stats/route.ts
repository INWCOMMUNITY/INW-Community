import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cron secret for authentication
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * POST /api/cron/aggregate-category-stats
 *
 * Daily aggregation of category mapping feedback into stats.
 * Updates confidence scores based on keep/override ratios.
 *
 * Run via cron: 0 3 * * * (daily at 3 AM)
 */
export async function POST(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get all feedback grouped by provider + remoteCategory
    const feedbackGroups = await prisma.categoryMappingFeedback.groupBy({
      by: ["provider", "remoteCategory"],
      _count: { id: true },
    });

    let updated = 0;

    for (const group of feedbackGroups) {
      // Get feedback for this category
      const feedback = await prisma.categoryMappingFeedback.findMany({
        where: {
          provider: group.provider,
          remoteCategory: group.remoteCategory,
        },
        orderBy: { createdAt: "desc" },
        take: 100, // Consider last 100 feedbacks
      });

      if (feedback.length === 0) continue;

      // Count keeps vs overrides
      let keepCount = 0;
      let overrideCount = 0;
      const categoryVotes: Map<string, number> = new Map();

      for (const f of feedback) {
        const kept = f.autoMapped === f.sellerChosen;
        if (kept) {
          keepCount++;
        } else {
          overrideCount++;
        }

        // Track most popular category choice
        const key = `${f.sellerChosen}|${f.sellerChosenSub ?? ""}`;
        categoryVotes.set(key, (categoryVotes.get(key) ?? 0) + 1);
      }

      // Find most popular category
      let bestCategory = feedback[0].sellerChosen;
      let bestSubcat = feedback[0].sellerChosenSub;
      let bestVotes = 0;
      for (const [key, votes] of categoryVotes) {
        if (votes > bestVotes) {
          bestVotes = votes;
          const [cat, sub] = key.split("|");
          bestCategory = cat;
          bestSubcat = sub || null;
        }
      }

      // Calculate new confidence based on keep ratio
      const total = keepCount + overrideCount;
      const keepRatio = total > 0 ? keepCount / total : 0.5;
      const newConfidence = 0.2 + keepRatio * 0.6; // Scale to 0.2-0.8

      // Upsert stats
      await prisma.categoryMappingStats.upsert({
        where: {
          provider_remoteCategory: {
            provider: group.provider,
            remoteCategory: group.remoteCategory,
          },
        },
        create: {
          provider: group.provider,
          remoteCategory: group.remoteCategory,
          mappedCategory: bestCategory,
          mappedSubcat: bestSubcat,
          confidence: newConfidence,
          keepCount,
          overrideCount,
        },
        update: {
          mappedCategory: bestCategory,
          mappedSubcat: bestSubcat,
          confidence: newConfidence,
          keepCount,
          overrideCount,
        },
      });

      updated++;
    }

    // Clean up old feedback (older than 90 days)
    const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const deleted = await prisma.categoryMappingFeedback.deleteMany({
      where: { createdAt: { lt: cutoffDate } },
    });

    console.log("[cron/aggregate-category-stats]", {
      updated,
      feedbackDeleted: deleted.count,
    });

    return NextResponse.json({
      ok: true,
      updated,
      feedbackDeleted: deleted.count,
    });
  } catch (e) {
    console.error("[cron/aggregate-category-stats] error:", e);
    return NextResponse.json(
      { error: "Aggregation failed" },
      { status: 500 }
    );
  }
}

// GET also supported for manual trigger in dev
export async function GET(req: NextRequest) {
  return POST(req);
}
