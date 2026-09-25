import { NextRequest, NextResponse } from "next/server";
import { enqueueDueShopifyListingReconciliations, prisma } from "database";
import { runNextShopifySyncJob } from "@/lib/shopify/admin-graphql";

export const dynamic = "force-dynamic";

/**
 * Protected Shopify sync worker + bounded reconcile discovery.
 * Callers must supply CRON_SECRET.
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

  const discovered = await enqueueDueShopifyListingReconciliations(prisma, {
    limit: 25,
    now: new Date(),
  });

  const results: Array<{ jobId: string; finalized: boolean; outcome: string }> = [];
  for (let i = 0; i < 10; i += 1) {
    const ran = await runNextShopifySyncJob({ workerId: `cron-shopify-${i}` });
    if (!ran.claimed) break;
    results.push({
      jobId: ran.jobId,
      finalized: ran.finalized,
      outcome: ran.result.outcome,
    });
  }
  return NextResponse.json({
    ok: true,
    reconcileEnqueued: discovered.enqueued,
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
