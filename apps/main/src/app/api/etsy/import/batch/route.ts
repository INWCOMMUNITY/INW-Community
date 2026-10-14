import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import {
  getEtsyImportBatchStatus,
  startEtsyImportBatch,
} from "@/lib/etsy/import-batch";
import { runNextEtsySyncJob } from "@/lib/etsy/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function kickImportBatchWorker(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    const ran = await runNextEtsySyncJob({
      workerId: `etsy-import-inline-${i}`,
      kind: "IMPORT_BATCH",
      leaseMs: 55_000,
    });
    if (!ran.claimed) break;
    if (ran.result.outcome !== "SUCCESS" && ran.result.outcome !== "RETRY") break;
  }
}

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const batch = await getEtsyImportBatchStatus({ memberId });
  return NextResponse.json({ batch });
}

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  let stockModePolicy = "RECOMMENDED";
  let listingIds: unknown;
  let shippingPrices: unknown;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      stockModePolicy?: unknown;
      listingIds?: unknown;
      shippingPrices?: unknown;
    };
    if (typeof body.stockModePolicy === "string" && body.stockModePolicy.trim()) {
      stockModePolicy = body.stockModePolicy.trim();
    }
    listingIds = body.listingIds;
    shippingPrices = body.shippingPrices;
  } catch {
    // empty body ok
  }

  const result = await startEtsyImportBatch({
    memberId,
    stockModePolicy,
    listingIds,
    shippingPrices,
  });
  if (result.status === "ERROR") {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.httpStatus }
    );
  }

  // Start importing immediately so the progress bar moves without waiting for cron.
  void kickImportBatchWorker(8).catch(() => undefined);

  return NextResponse.json({
    status: result.status,
    batch: result.batch,
  });
}
