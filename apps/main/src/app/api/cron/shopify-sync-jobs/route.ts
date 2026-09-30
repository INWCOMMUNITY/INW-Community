import { NextRequest, NextResponse } from "next/server";
import { enqueueDueShopifyListingReconciliations, prisma } from "database";
import { runNextShopifySyncJob } from "@/lib/shopify/admin-graphql";
import { releaseCronLock, tryAcquireCronLock } from "@/lib/cron-job-lock";
import { reconcileActiveShopifyConnectionWebhooks } from "@/lib/shopify/ensure-required-webhooks";

export const dynamic = "force-dynamic";

/** Periodic connection-level webhook ensure (not every one-minute tick). */
const SHOPIFY_REQUIRED_WEBHOOKS_LOCK = "shopify-required-webhooks";
const SHOPIFY_REQUIRED_WEBHOOKS_TTL_MS = 6 * 60 * 60 * 1000;

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

  let webhooks: Awaited<ReturnType<typeof reconcileActiveShopifyConnectionWebhooks>> | null = null;
  const webhookLock = await tryAcquireCronLock(
    SHOPIFY_REQUIRED_WEBHOOKS_LOCK,
    SHOPIFY_REQUIRED_WEBHOOKS_TTL_MS
  );
  if (webhookLock.acquired) {
    try {
      webhooks = await reconcileActiveShopifyConnectionWebhooks();
      // Keep the lease until TTL so one-minute ticks do not re-query Shopify every minute.
      // Release early only when repair failed so the next tick can retry.
      if (webhooks.failed > 0) {
        await releaseCronLock(SHOPIFY_REQUIRED_WEBHOOKS_LOCK, webhookLock.holderId);
      }
    } catch (error) {
      await releaseCronLock(SHOPIFY_REQUIRED_WEBHOOKS_LOCK, webhookLock.holderId);
      console.info("SHOPIFY_REQUIRED_WEBHOOKS_ENSURE", {
        ok: false,
        errorCode: "RECONCILE_THROW",
        reason: error instanceof Error ? error.message.slice(0, 180) : "reconcile failed",
      });
    }
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
    webhooksEnsured: webhooks
      ? {
          checked: webhooks.checked,
          ok: webhooks.ok,
          repaired: webhooks.repaired,
          failed: webhooks.failed,
        }
      : null,
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
