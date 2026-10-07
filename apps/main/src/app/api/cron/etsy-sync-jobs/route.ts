import { NextRequest, NextResponse } from "next/server";
import {
  enqueueDueEtsyListingContentPolls,
  enqueueDueEtsyListingReconciliations,
  prisma,
} from "database";
import { runNextEtsySyncJob } from "@/lib/etsy/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Protected Etsy sync worker. Callers must supply CRON_SECRET.
 * Discovers due listing content polls + reconciles, then drains sync jobs.
 * Claim priority: outbound mutations → evidence → POLL inbound → RECONCILE.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const discovered = await enqueueDueEtsyListingContentPolls(prisma, {
    limit: 20,
    now: new Date(),
  });
  const reconciled = await enqueueDueEtsyListingReconciliations(prisma, {
    limit: 25,
    now: new Date(),
  });

  const results: Array<{ jobId: string; finalized: boolean; outcome: string }> = [];
  // Inbound listing edits must not wait behind outbound inventory and content jobs.
  for (let i = 0; i < 4; i += 1) {
    const ran = await runNextEtsySyncJob({
      workerId: `cron-etsy-poll-${i}`,
      kind: "POLL_LISTING_CONTENT",
    });
    if (!ran.claimed) break;
    results.push({
      jobId: ran.jobId,
      finalized: ran.finalized,
      outcome: ran.result.outcome,
    });
  }
  for (let i = 0; i < 40; i += 1) {
    const ran = await runNextEtsySyncJob({ workerId: `cron-etsy-${i}` });
    if (!ran.claimed) break;
    results.push({
      jobId: ran.jobId,
      finalized: ran.finalized,
      outcome: ran.result.outcome,
    });
  }

  return NextResponse.json({
    ok: true,
    discovered: discovered.enqueued,
    reconciled: reconciled.enqueued,
    processed: results.length,
    results,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
