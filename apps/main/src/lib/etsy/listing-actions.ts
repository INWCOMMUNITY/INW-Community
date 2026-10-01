import { prisma } from "database";
import { etsyListingIsPubliclyViewable } from "./apps-airport";
import type { EtsyFetch } from "./client";
import { etsyConnectionRequest } from "./connection-request";
import { enqueueEtsyCreateListing, etsyCreateListingDedupeKey } from "./create-listing";

export type EtsyListingAction = "retry" | "remove";

export type EtsyListingActionResult =
  | { ok: true; message?: string }
  | { ok: false; status: number; error: string; code?: string };

async function loadMappedListing(input: {
  memberId: string;
  storeItemId: string;
}): Promise<
  | {
      connection: {
        id: string;
        shopId: string;
      };
      listing: {
        id: string;
        storeItemId: string;
        etsyListingId: string;
        remoteListingState: string | null;
      };
    }
  | { error: string; status: number }
> {
  const connection = await prisma.etsyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true, shopId: true },
  });
  if (!connection) {
    return { error: "No active Etsy connection", status: 409 };
  }
  const listing = await prisma.etsyListingLink.findFirst({
    where: {
      etsyConnectionId: connection.id,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
    },
    select: {
      id: true,
      storeItemId: true,
      etsyListingId: true,
      remoteListingState: true,
    },
  });
  if (!listing) {
    return { error: "Listing is not linked to Etsy", status: 404 };
  }
  return { connection, listing };
}

async function deleteRemoteEtsyListing(input: {
  connectionId: string;
  memberId: string;
  etsyListingId: string;
  fetchImpl?: EtsyFetch;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const listingId = String(input.etsyListingId ?? "").trim();
  if (!/^\d+$/.test(listingId)) {
    return { ok: true };
  }
  const result = await etsyConnectionRequest({
    connectionId: input.connectionId,
    memberId: input.memberId,
    method: "DELETE",
    path: `/listings/${encodeURIComponent(listingId)}`,
    maxAttempts: 1,
    fetchImpl: input.fetchImpl,
  });
  if (result.ok || result.httpStatus === 404) {
    return { ok: true };
  }
  // Already gone / not deletable in current state — still allow local unlink when caller chooses.
  if (
    result.httpStatus === 409 ||
    /already|not found|cannot be deleted|can't be deleted/i.test(result.message)
  ) {
    return { ok: false, error: result.message };
  }
  return { ok: false, error: result.message || "Could not delete Etsy listing" };
}

async function deleteListingMapping(listingLinkId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.etsyVariantMap.deleteMany({ where: { etsyListingLinkId: listingLinkId } });
    await tx.etsyListingLink.delete({ where: { id: listingLinkId } });
  });
}

async function stopPendingCreateJob(input: {
  connectionId: string;
  storeItemId: string;
}): Promise<void> {
  const dedupeKey = etsyCreateListingDedupeKey(input.connectionId, input.storeItemId);
  await prisma.etsySyncJob.updateMany({
    where: {
      etsyConnectionId: input.connectionId,
      dedupeKey,
      state: { in: ["PENDING", "RETRY_WAIT", "RUNNING"] },
    },
    data: {
      state: "DEAD",
      completedAt: new Date(),
      lastErrorClass: "CANCELLED",
      lastErrorCode: "MAPPING_REMOVED",
      lastErrorMessage: "Listing mapping removed by seller",
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
}

export async function runEtsyListingAction(input: {
  memberId: string;
  storeItemId: string;
  action: EtsyListingAction;
  confirmDelete?: boolean;
  fetchImpl?: EtsyFetch;
}): Promise<EtsyListingActionResult> {
  const loaded = await loadMappedListing({
    memberId: input.memberId,
    storeItemId: input.storeItemId,
  });
  if ("error" in loaded) {
    return { ok: false, status: loaded.status, error: loaded.error };
  }
  const { connection, listing } = loaded;

  if (input.action === "retry") {
    if (etsyListingIsPubliclyViewable(listing.remoteListingState)) {
      return {
        ok: false,
        status: 409,
        error: "Listing is already live on Etsy",
        code: "ALREADY_LIVE",
      };
    }
    const queued = await enqueueEtsyCreateListing({
      memberId: input.memberId,
      storeItemId: listing.storeItemId,
    });
    if (queued.status === "QUEUED") {
      return { ok: true, message: "List on Etsy queued" };
    }
    if (queued.status === "ALREADY_MAPPED") {
      return { ok: true, message: "Already live on Etsy" };
    }
    return {
      ok: false,
      status: 400,
      error: queued.message,
      code: queued.code,
    };
  }

  // remove
  if (input.confirmDelete) {
    const deleted = await deleteRemoteEtsyListing({
      connectionId: connection.id,
      memberId: input.memberId,
      etsyListingId: listing.etsyListingId,
      fetchImpl: input.fetchImpl,
    });
    if (!deleted.ok) {
      return {
        ok: false,
        status: 502,
        error: deleted.error,
        code: "LISTING_DELETE_FAILED",
      };
    }
  }

  await stopPendingCreateJob({
    connectionId: connection.id,
    storeItemId: listing.storeItemId,
  });
  await deleteListingMapping(listing.id);
  return {
    ok: true,
    message: input.confirmDelete
      ? "Removed from Etsy and unlinked in INW"
      : "Unlinked from Etsy (listing left on Etsy)",
  };
}
