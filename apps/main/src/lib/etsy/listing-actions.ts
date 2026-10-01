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

/**
 * Best-effort remote delete. Never blocks local unlink — Etsy often refuses DELETE
 * on active listings, and app config may be missing while the DB link still exists.
 */
async function deleteRemoteEtsyListing(input: {
  connectionId: string;
  memberId: string;
  shopId: string;
  etsyListingId: string;
  remoteListingState?: string | null;
  fetchImpl?: EtsyFetch;
}): Promise<{ deleted: boolean; detail: string | null }> {
  const listingId = String(input.etsyListingId ?? "").trim();
  if (!/^\d+$/.test(listingId)) {
    return { deleted: true, detail: null };
  }

  // Active listings often cannot be deleted until deactivated.
  if (etsyListingIsPubliclyViewable(input.remoteListingState)) {
    const deactivate = await etsyConnectionRequest({
      connectionId: input.connectionId,
      memberId: input.memberId,
      method: "PATCH",
      path: `/shops/${encodeURIComponent(input.shopId)}/listings/${encodeURIComponent(listingId)}`,
      bodyEncoding: "form",
      body: { state: "inactive" },
      maxAttempts: 1,
      fetchImpl: input.fetchImpl,
    });
    if (!deactivate.ok && deactivate.class !== "NOT_CONFIGURED") {
      // Continue to DELETE anyway — some shops allow direct delete.
    }
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
    return { deleted: true, detail: null };
  }
  return {
    deleted: false,
    detail: result.message?.trim() || `Etsy delete failed (${result.class})`,
  };
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
  try {
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

    // remove — local unlink is the seller-facing success; remote delete is best-effort.
    let remoteDetail: string | null = null;
    let remoteDeleted = false;
    if (input.confirmDelete) {
      const remote = await deleteRemoteEtsyListing({
        connectionId: connection.id,
        memberId: input.memberId,
        shopId: connection.shopId,
        etsyListingId: listing.etsyListingId,
        remoteListingState: listing.remoteListingState,
        fetchImpl: input.fetchImpl,
      });
      remoteDeleted = remote.deleted;
      remoteDetail = remote.detail;
    }

    await stopPendingCreateJob({
      connectionId: connection.id,
      storeItemId: listing.storeItemId,
    });
    await deleteListingMapping(listing.id);

    if (!input.confirmDelete) {
      return { ok: true, message: "Unlinked from Etsy (listing left on Etsy)" };
    }
    if (remoteDeleted) {
      return { ok: true, message: "Removed from Etsy and unlinked in INW" };
    }
    return {
      ok: true,
      message: remoteDetail
        ? `Unlinked in INW. Etsy listing was not deleted: ${remoteDetail}`
        : "Unlinked in INW. Etsy listing was not deleted.",
    };
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "Could not remove Etsy listing link";
    return { ok: false, status: 500, error: message, code: "REMOVE_FAILED" };
  }
}
