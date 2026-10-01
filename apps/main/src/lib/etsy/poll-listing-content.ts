import {
  applyEtsyListingContentInbound,
  etsyCentsFromMoney,
  markEtsyListingContentPollComplete,
  prisma,
  type EtsyJobHandlerResult,
  type EtsyRemoteListingObservation,
  type EtsySyncJobClaim,
} from "database";
import { etsyConnectionRequest } from "./connection-request";
import type { EtsyFetch } from "./client";

const MAX_LISTINGS_PER_POLL = 25;

type RemoteListing = {
  listing_id?: number | string;
  title?: string;
  description?: string;
  last_modified_tsz?: number;
  images?: Array<{ url_fullxfull?: string; url_570xN?: string }>;
};

type RemoteInventory = {
  products?: Array<{
    product_id?: number | string;
    sku?: string | null;
    offerings?: Array<{
      offering_id?: number | string;
      price?: number | string | { amount?: number; divisor?: number };
    }>;
  }>;
};

function classifyFailure(
  apiClass: string,
  retryAfterMs: number | null
): Extract<EtsyJobHandlerResult, { outcome: "RETRY" | "DEAD" }> {
  if (apiClass === "THROTTLED" || apiClass === "TRANSIENT" || apiClass === "NETWORK") {
    return {
      outcome: "RETRY",
      errorClass: apiClass,
      errorCode: apiClass,
      errorMessage: `Etsy provider ${apiClass}`,
      retryAt: retryAfterMs != null ? new Date(Date.now() + retryAfterMs) : undefined,
    };
  }
  if (apiClass === "AUTH" || apiClass === "CONNECTION_INACTIVE" || apiClass === "NOT_CONFIGURED") {
    return {
      outcome: "DEAD",
      errorClass: apiClass,
      errorCode: apiClass,
      errorMessage: `Etsy authorization unavailable (${apiClass})`,
    };
  }
  return {
    outcome: "DEAD",
    errorClass: apiClass || "PERMANENT",
    errorCode: apiClass || "PROVIDER_ERROR",
    errorMessage: "Etsy listing poll failed permanently",
  };
}

async function fetchRemoteObservation(input: {
  connectionId: string;
  memberId: string;
  shopId: string;
  etsyListingId: string;
  fetchImpl?: EtsyFetch;
  now?: Date;
}): Promise<
  | { ok: true; remote: EtsyRemoteListingObservation }
  | { ok: false; failure: Extract<EtsyJobHandlerResult, { outcome: "RETRY" | "DEAD" }> }
> {
  const listingPath = `/shops/${encodeURIComponent(input.shopId)}/listings/${encodeURIComponent(input.etsyListingId)}`;
  const listingRes = await etsyConnectionRequest<RemoteListing>({
    connectionId: input.connectionId,
    memberId: input.memberId,
    method: "GET",
    path: listingPath,
    query: { includes: "Images" },
    maxAttempts: 3,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!listingRes.ok || !listingRes.data) {
    return { ok: false, failure: classifyFailure(listingRes.class, listingRes.retryAfterMs) };
  }

  const inventoryRes = await etsyConnectionRequest<RemoteInventory>({
    connectionId: input.connectionId,
    memberId: input.memberId,
    method: "GET",
    path: `/listings/${encodeURIComponent(input.etsyListingId)}/inventory`,
    query: { max_variations_supported: 3 },
    maxAttempts: 3,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!inventoryRes.ok || !inventoryRes.data) {
    return { ok: false, failure: classifyFailure(inventoryRes.class, inventoryRes.retryAfterMs) };
  }

  const variants: EtsyRemoteListingObservation["variants"] = [];
  for (const product of inventoryRes.data.products ?? []) {
    const productId = String(product.product_id ?? "");
    for (const offering of product.offerings ?? []) {
      const offeringId = String(offering.offering_id ?? "");
      if (!productId || !offeringId) continue;
      const priceObj =
        offering.price && typeof offering.price === "object"
          ? (offering.price as { amount?: number; divisor?: number })
          : null;
      const priceCents = etsyCentsFromMoney({
        amount: priceObj?.amount,
        divisor: priceObj?.divisor,
        price:
          typeof offering.price === "number" || typeof offering.price === "string"
            ? offering.price
            : null,
      });
      if (!Number.isFinite(priceCents)) continue;
      variants.push({
        etsyProductId: productId,
        etsyOfferingId: offeringId,
        priceCents,
        sku: typeof product.sku === "string" ? product.sku : null,
      });
    }
  }

  return {
    ok: true,
    remote: {
      etsyListingId: input.etsyListingId,
      title: typeof listingRes.data.title === "string" ? listingRes.data.title : "",
      description: typeof listingRes.data.description === "string" ? listingRes.data.description : null,
      photos: (listingRes.data.images ?? [])
        .map((img) => img.url_fullxfull || img.url_570xN || "")
        .filter(Boolean),
      updatedAt:
        typeof listingRes.data.last_modified_tsz === "number"
          ? new Date(listingRes.data.last_modified_tsz * 1000)
          : null,
      variants,
    },
  };
}

/**
 * POLL_LISTING_CONTENT handler.
 * Re-reads mapped Etsy listings, applies inbound with echo suppression, fans out Shopify desires.
 * Only marks the connection poll complete when every listing fetch succeeds (no cursor advance on failure).
 */
export async function handleEtsyPollListingContentJob(
  claim: EtsySyncJobClaim,
  deps: { fetchImpl?: EtsyFetch; now?: Date; maxListings?: number } = {}
): Promise<EtsyJobHandlerResult> {
  const connection = await prisma.etsyConnection.findUnique({
    where: { id: claim.etsyConnectionId },
  });
  if (!connection || connection.status !== "ACTIVE") {
    return {
      outcome: "DEAD",
      errorClass: "CONNECTION_INACTIVE",
      errorCode: "CONNECTION_INACTIVE",
      errorMessage: "Etsy connection is not active for this generation",
    };
  }

  const links = await prisma.etsyListingLink.findMany({
    where: { etsyConnectionId: connection.id },
    orderBy: { updatedAt: "asc" },
    take: deps.maxListings ?? MAX_LISTINGS_PER_POLL,
    select: { id: true, etsyListingId: true },
  });

  for (const link of links) {
    const fetched = await fetchRemoteObservation({
      connectionId: connection.id,
      memberId: connection.memberId,
      shopId: connection.shopId,
      etsyListingId: link.etsyListingId,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
    if (!fetched.ok) {
      // Do not advance poll watermark — retry whole job.
      return fetched.failure;
    }

    await prisma.$transaction(async (tx) => {
      await applyEtsyListingContentInbound(tx, {
        connectionId: connection.id,
        memberId: connection.memberId,
        listingLinkId: link.id,
        remote: fetched.remote,
        now: deps.now,
      });
    });
  }

  await markEtsyListingContentPollComplete(prisma, {
    connectionId: connection.id,
    now: deps.now,
  });
  return { outcome: "SUCCESS" };
}
