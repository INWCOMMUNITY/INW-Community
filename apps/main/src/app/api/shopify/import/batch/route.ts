import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import {
  getShopifyImportBatchStatus,
  startShopifyImportBatch,
} from "@/lib/shopify/import-batch";
import { runNextShopifySyncJob } from "@/lib/shopify/admin-graphql";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function kickImportBatchWorker(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    const ran = await runNextShopifySyncJob({
      workerId: `shopify-import-inline-${i}`,
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

  const batch = await getShopifyImportBatchStatus({ memberId });
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
  try {
    const body = (await req.json().catch(() => ({}))) as { stockModePolicy?: unknown };
    if (typeof body.stockModePolicy === "string" && body.stockModePolicy.trim()) {
      stockModePolicy = body.stockModePolicy.trim();
    }
  } catch {
    // empty body ok
  }

  const result = await startShopifyImportBatch({ memberId, stockModePolicy });
  if (result.status === "ERROR") {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.httpStatus }
    );
  }

  void kickImportBatchWorker(8).catch(() => undefined);

  return NextResponse.json({
    status: result.status,
    batch: result.batch,
  });
}
