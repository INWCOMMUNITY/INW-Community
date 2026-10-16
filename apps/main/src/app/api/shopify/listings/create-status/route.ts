import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

const jobSelect = {
  id: true,
  kind: true,
  state: true,
  attemptCount: true,
  lastErrorCode: true,
  lastErrorMessage: true,
  completedAt: true,
  updatedAt: true,
} as const;

/**
 * Poll CREATE_LISTING job + mapped listing status for Sync Airport progress UI.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const storeItemId = req.nextUrl.searchParams.get("storeItemId")?.trim() ?? "";
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  if (!storeItemId && !jobId) {
    return NextResponse.json({ error: "storeItemId or jobId is required" }, { status: 400 });
  }

  const connection = await prisma.shopifyConnection.findFirst({
    where: { memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) {
    return NextResponse.json({ connectionStatus: "DISCONNECTED", job: null, listing: null });
  }

  const job = jobId
    ? await prisma.shopifySyncJob.findFirst({
        where: { id: jobId, shopifyConnectionId: connection.id },
        select: jobSelect,
      })
    : storeItemId
      ? await prisma.shopifySyncJob.findFirst({
          where: {
            shopifyConnectionId: connection.id,
            kind: "CREATE_LISTING",
            dedupeKey: `CREATE_LISTING:${connection.id}:${storeItemId}`,
          },
          select: jobSelect,
        })
      : null;

  const listingRow = storeItemId
    ? await prisma.shopifyListingLink.findFirst({
        where: {
          shopifyConnectionId: connection.id,
          memberId,
          storeItemId,
        },
        select: {
          storeItemId: true,
          readiness: true,
          remoteProductStatus: true,
          issueMessage: true,
          variantMaps: {
            select: { inventoryInitState: true },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      })
    : null;

  const listing = listingRow
    ? {
        storeItemId: listingRow.storeItemId,
        readiness: listingRow.readiness,
        remoteProductStatus: listingRow.remoteProductStatus,
        issueMessage: listingRow.issueMessage,
        inventoryInitState: listingRow.variantMaps[0]?.inventoryInitState ?? null,
      }
    : null;

  return NextResponse.json({
    connectionStatus: "ACTIVE",
    job: job
      ? {
          id: job.id,
          kind: job.kind,
          state: job.state,
          attemptCount: job.attemptCount,
          errorCode: job.lastErrorCode,
          errorMessage: job.lastErrorMessage,
          completedAt: job.completedAt,
          updatedAt: job.updatedAt,
        }
      : null,
    listing,
  });
}
