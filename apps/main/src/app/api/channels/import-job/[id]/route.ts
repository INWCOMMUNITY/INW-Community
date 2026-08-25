import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getBatchImportJob, serializeBatchImportJob } from "@/lib/channels/batch-import";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/channels/import-job/[id]
 *
 * Get the status of a batch import job, including live percent, current title,
 * and imported / skipped rows for the result tabs.
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

    if (job.memberId !== userId) {
      return NextResponse.json({ error: "Not authorized to view this job" }, { status: 403 });
    }

    return NextResponse.json(serializeBatchImportJob(job));
  } catch (e) {
    console.error("[import-job] GET error:", e);
    return NextResponse.json(
      { error: "Failed to get job status" },
      { status: 500 }
    );
  }
}
