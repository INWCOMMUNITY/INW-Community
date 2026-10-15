import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { sellerEtsyErrorMessage } from "@/lib/etsy/marketplace-rejection";

export const dynamic = "force-dynamic";

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

  const connection = await prisma.etsyConnection.findFirst({
    where: { memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) {
    return NextResponse.json({ connectionStatus: "DISCONNECTED", job: null, listing: null });
  }

  let job = null;
  if (jobId) {
    job = await prisma.etsySyncJob.findFirst({
      where: { id: jobId, etsyConnectionId: connection.id },
      select: {
        id: true,
        kind: true,
        state: true,
        attemptCount: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        completedAt: true,
        updatedAt: true,
      },
    });
  } else if (storeItemId) {
    job = await prisma.etsySyncJob.findFirst({
      where: {
        etsyConnectionId: connection.id,
        kind: "CREATE_LISTING",
        dedupeKey: `CREATE_LISTING:${connection.id}:${storeItemId}`,
      },
      select: {
        id: true,
        kind: true,
        state: true,
        attemptCount: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        completedAt: true,
        updatedAt: true,
      },
    });
  }

  const howMade = storeItemId
    ? await prisma.storeItem.findFirst({
        where: { id: storeItemId, memberId },
        select: { etsyWhoMade: true, etsyWhenMade: true, etsyIsSupply: true },
      })
    : null;

  const listing =
    storeItemId || job
      ? await prisma.etsyListingLink.findFirst({
          where: {
            etsyConnectionId: connection.id,
            memberId,
            ...(storeItemId ? { storeItemId } : {}),
          },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            storeItemId: true,
            etsyListingId: true,
            readiness: true,
            remoteListingState: true,
            issueCode: true,
            issueMessage: true,
          },
        })
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
          errorMessage: sellerEtsyErrorMessage(job.lastErrorMessage, {
            whoMade: howMade?.etsyWhoMade,
            whenMade: howMade?.etsyWhenMade,
            isSupply: howMade?.etsyIsSupply,
          }),
          completedAt: job.completedAt,
          updatedAt: job.updatedAt,
        }
      : null,
    listing: listing
      ? {
          ...listing,
          issueMessage: sellerEtsyErrorMessage(listing.issueMessage, {
            whoMade: howMade?.etsyWhoMade,
            whenMade: howMade?.etsyWhenMade,
            isSupply: howMade?.etsyIsSupply,
          }),
        }
      : null,
  });
}
