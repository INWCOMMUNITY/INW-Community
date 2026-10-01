import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getSessionForApi } from "@/lib/mobile-auth";
import { enqueueEtsyCreateListing } from "@/lib/etsy/create-listing";
import { runNextEtsySyncJob } from "@/lib/etsy/worker";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

async function drainEtsyJobs(max = 5) {
  for (let i = 0; i < max; i += 1) {
    const ran = await runNextEtsySyncJob({ workerId: `etsy-create-inline-${i}` });
    if (!ran.claimed) break;
  }
}

/** Explicit seller action: queue CREATE_LISTING for a StoreItem. */
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

  const result = await enqueueEtsyCreateListing({ memberId, storeItemId });
  if (result.status === "ALREADY_MAPPED") {
    return NextResponse.json({
      status: "already_mapped",
      connectionId: result.connectionId,
      storeItemId: result.storeItemId,
      etsyListingId: result.etsyListingId,
    });
  }
  if (result.status === "QUEUED") {
    // Don't wait only on Vercel cron — process immediately after enqueue.
    waitUntil(drainEtsyJobs());
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
      : result.code === "HOW_ITS_MADE_REQUIRED" || result.code === "SHIPPING_PROFILE_REQUIRED"
        ? 422
        : result.code === "CONNECTION_INACTIVE" ||
            result.code === "UNSUPPORTED_VARIANTS" ||
            result.code === "INVALID_ITEM" ||
            result.code === "CONFLICT"
          ? 409
          : 400;
  return NextResponse.json(
    { error: result.message, code: result.code, missing: result.missing },
    { status }
  );
}
