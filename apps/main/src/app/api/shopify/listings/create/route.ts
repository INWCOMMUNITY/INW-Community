import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { enqueueShopifyCreateListing } from "@/lib/shopify/create-listing";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

async function drainShopifyJobsAfterCreate(max = 8) {
  const { runNextShopifySyncJob } = await import("@/lib/shopify/admin-graphql");
  // Prefer outbound listing work over import/reconcile while the seller waits.
  for (let i = 0; i < max; i += 1) {
    const create = await runNextShopifySyncJob({
      workerId: `shopify-create-inline-${i}`,
      kind: "CREATE_LISTING",
    });
    if (create.claimed) continue;
    const publish = await runNextShopifySyncJob({
      workerId: `shopify-create-publish-inline-${i}`,
      kind: "PUBLISH_LISTING",
    });
    if (publish.claimed) continue;
    break;
  }
}

/**
 * Explicit seller action: queue CREATE_LISTING for a simple StoreItem.
 * Does not wait for Shopify productSet.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  let storeItemId = "";
  try {
    const body = (await req.json()) as { storeItemId?: unknown };
    storeItemId = typeof body.storeItemId === "string" ? body.storeItemId.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!storeItemId) {
    return NextResponse.json({ error: "storeItemId is required" }, { status: 400 });
  }

  const result = await enqueueShopifyCreateListing({ memberId, storeItemId });
  if (result.status === "ALREADY_MAPPED") {
    return NextResponse.json({
      status: "already_mapped",
      connectionId: result.connectionId,
      storeItemId: result.storeItemId,
      shopifyProductId: result.shopifyProductId,
    });
  }
  if (result.status === "QUEUED") {
    // Don't wait only on Vercel cron — process immediately after enqueue.
    waitUntil(drainShopifyJobsAfterCreate());
    return NextResponse.json({
      status: "queued",
      connectionId: result.connectionId,
      storeItemId: result.storeItemId,
      jobId: result.jobId,
    });
  }

  const status =
    result.code === "NOT_FOUND"
      ? 404
      : result.code === "CONNECTION_INACTIVE" ||
          result.code === "LOCATION_REQUIRED" ||
          result.code === "UNSUPPORTED_VARIANTS" ||
          result.code === "INACTIVE" ||
          result.code === "MISSING_TITLE" ||
        result.code === "MISSING_PRICE" ||
        result.code === "SHARED_QUANTITY" ||
        result.code === "CONFLICT"
        ? 409
        : 400;
  return NextResponse.json({ error: result.message, code: result.code }, { status });
}
