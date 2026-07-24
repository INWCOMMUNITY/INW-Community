import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getBatchImportJob } from "@/lib/channels/batch-import";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/channels/import-job/[id]
 *
 * Get the status of a batch import job.
 *
 * Response:
 * {
 *   id: string,
 *   status: "pending" | "processing" | "completed" | "failed",
 *   provider: "ebay" | "etsy" | "shopify" | "wix",
 *   total: number,
 *   completed: number,
 *   failed: number,
 *   errors: [{ listingId, error }, ...],
 *   progress: number,  // 0-100
 *   createdAt: string,
 *   startedAt?: string,
 *   completedAt?: string
 * }
 */
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    const job = await getBatchImportJob(id);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Verify ownership
    if (job.memberId !== userId) {
      return NextResponse.json({ error: "Not authorized to view this job" }, { status: 403 });
    }

    const progress = job.total > 0 ? Math.round(((job.completed + job.failed) / job.total) * 100) : 0;

    return NextResponse.json({
      id: job.id,
      status: job.status,
      provider: job.provider,
      total: job.total,
      completed: job.completed,
      failed: job.failed,
      errors: job.errors.slice(-20),
      progress,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString(),
      completedAt: job.completedAt?.toISOString(),
    });
  } catch (e) {
    console.error("[import-job] GET error:", e);
    return NextResponse.json(
      { error: "Failed to get job status" },
      { status: 500 }
    );
  }
}
