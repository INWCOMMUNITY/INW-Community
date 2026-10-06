import { NextRequest, NextResponse } from "next/server";
import { drainWixSyncJobs } from "@/lib/wix/worker";
import { isWixConfigured } from "@/lib/wix/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Protected Wix sync worker.
 * Callers must supply CRON_SECRET.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isWixConfigured()) {
    return NextResponse.json({ message: "Wix is not configured" });
  }

  try {
    const result = await drainWixSyncJobs({
      maxJobs: 50,
      workerId: `wix-cron-${Date.now()}`,
    });

    return NextResponse.json({
      processed: result.processed,
      results: result.results.map((row) => ({
        jobId: row.jobId.slice(0, 8),
        outcome: row.outcome,
      })),
    });
  } catch (error) {
    console.error("Wix cron error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
