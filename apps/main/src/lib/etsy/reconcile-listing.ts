import {
  prisma,
  reconcileEtsyListingHealthFromDb,
  type EtsyJobHandlerResult,
  type EtsySyncJobClaim,
} from "database";

function parsePayload(payload: unknown): { listingLinkId: string; storeItemId: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const listingLinkId = typeof row.listingLinkId === "string" ? row.listingLinkId : "";
  const storeItemId = typeof row.storeItemId === "string" ? row.storeItemId : "";
  if (!listingLinkId || !storeItemId) return null;
  return { listingLinkId, storeItemId };
}

/** RECONCILE_LISTING: refresh durable readiness/health from DB truth (no Etsy network). */
export async function handleEtsyReconcileListingJob(
  claim: EtsySyncJobClaim
): Promise<EtsyJobHandlerResult> {
  const payload = parsePayload(claim.payload);
  if (!payload) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "RECONCILE_LISTING payload is invalid",
    };
  }

  const health = await reconcileEtsyListingHealthFromDb(prisma, {
    connectionId: claim.etsyConnectionId,
    listingLinkId: payload.listingLinkId,
  });
  if (!health) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "LISTING_MISSING",
      errorMessage: "Mapped Etsy listing was not found for reconcile",
    };
  }
  return { outcome: "SUCCESS" };
}
