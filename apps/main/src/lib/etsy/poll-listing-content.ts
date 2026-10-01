import {
  applyEtsyListingContentInbound,
  applyEtsyListingInventoryInbound,
  enqueueEtsySyncJob,
  etsyCentsFromMoney,
  markEtsyListingContentPollComplete,
  prisma,
  resolveEtsyHowItsMadeForCreate,
  type EtsyJobHandlerResult,
  type EtsyRemoteListingObservation,
  type EtsySyncJobClaim,
} from "database";
import { etsyConnectionRequest } from "./connection-request";
import type { EtsyFetch } from "./client";
import { optionsFromEtsyPropertyValues } from "./listing-variants";
import {
  isSyncEtsyVariantTopologyFailure,
  syncEtsyListingVariantTopology,
} from "./sync-listing-variants";
import { resolveEtsyTaxonomyFallback, sanitizeEtsyTaxonomyId } from "./taxonomy-default";
import { resolveEtsyReadinessStateId } from "./readiness-state";

const MAX_LISTINGS_PER_POLL = 25;

function createListingDedupeKey(connectionId: string, storeItemId: string): string {
  return `CREATE_LISTING:${connectionId}:${storeItemId}`;
}

type RemoteListing = {
  listing_id?: number | string;
  title?: string;
  description?: string;
  state?: string;
  last_modified_tsz?: number;
  images?: Array<{ url_fullxfull?: string; url_570xN?: string }>;
};

type RemoteInventory = {
  products?: Array<{
    product_id?: number | string;
    sku?: string | null;
    property_values?: Array<{
      property_id?: number;
      property_name?: string;
      values?: string[];
      value_ids?: number[];
      scale_id?: number | null;
    }>;
    offerings?: Array<{
      offering_id?: number | string;
      quantity?: number;
      price?: number | string | { amount?: number; divisor?: number };
    }>;
  }>;
};

const CONNECTION_LEVEL_FAILURES = new Set(["AUTH", "CONNECTION_INACTIVE", "NOT_CONFIGURED"]);

function classifyFailure(
  apiClass: string,
  retryAfterMs: number | null,
  message?: string | null
): Extract<EtsyJobHandlerResult, { outcome: "RETRY" | "DEAD" }> {
  if (apiClass === "THROTTLED" || apiClass === "TRANSIENT" || apiClass === "NETWORK") {
    return {
      outcome: "RETRY",
      errorClass: apiClass,
      errorCode: apiClass,
      errorMessage: message?.trim() || `Etsy provider ${apiClass}`,
      retryAt: retryAfterMs != null ? new Date(Date.now() + retryAfterMs) : undefined,
    };
  }
  if (apiClass === "AUTH" || apiClass === "CONNECTION_INACTIVE" || apiClass === "NOT_CONFIGURED") {
    return {
      outcome: "DEAD",
      errorClass: apiClass,
      errorCode: apiClass,
      errorMessage: message?.trim() || `Etsy authorization unavailable (${apiClass})`,
    };
  }
  return {
    outcome: "DEAD",
    errorClass: apiClass || "PERMANENT",
    errorCode: apiClass || "PROVIDER_ERROR",
    errorMessage: message?.trim() || "Etsy listing poll failed permanently",
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
  // Canonical getListing — shop-scoped GET 404s for some live listings while
  // /listings/{id}/inventory still succeeds (same pattern as UPDATE_LISTING_CONTENT).
  const listingRes = await etsyConnectionRequest<RemoteListing>({
    connectionId: input.connectionId,
    memberId: input.memberId,
    method: "GET",
    path: `/listings/${encodeURIComponent(input.etsyListingId)}`,
    query: { includes: "Images" },
    maxAttempts: 3,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!listingRes.ok || !listingRes.data) {
    return {
      ok: false,
      failure: classifyFailure(listingRes.class, listingRes.retryAfterMs, listingRes.message),
    };
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
    return {
      ok: false,
      failure: classifyFailure(inventoryRes.class, inventoryRes.retryAfterMs, inventoryRes.message),
    };
  }

  const variants: EtsyRemoteListingObservation["variants"] = [];
  for (const product of inventoryRes.data.products ?? []) {
    const productId = String(product.product_id ?? "");
    const options = optionsFromEtsyPropertyValues(product.property_values);
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
      const quantity =
        typeof offering.quantity === "number" && Number.isFinite(offering.quantity)
          ? Math.max(0, Math.trunc(offering.quantity))
          : null;
      variants.push({
        etsyProductId: productId,
        etsyOfferingId: offeringId,
        priceCents,
        sku: typeof product.sku === "string" ? product.sku : null,
        quantity,
        options: Object.keys(options).length > 0 ? options : null,
      });
    }
  }

  return {
    ok: true,
    remote: {
      etsyListingId: input.etsyListingId,
      title: typeof listingRes.data.title === "string" ? listingRes.data.title : "",
      description: typeof listingRes.data.description === "string" ? listingRes.data.description : null,
      state: typeof listingRes.data.state === "string" ? listingRes.data.state : null,
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
 * Re-reads mapped Etsy listings, applies content + inventory inbound (Etsy→INW),
 * fans out Shopify desires when remote wins. Echo-suppresses outbound loops.
 * A listing-local failure is stored on that link and the poll continues.
 * Auth, config, and transient failures still stop the job so the watermark does not advance.
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
    select: {
      id: true,
      etsyListingId: true,
      storeItemId: true,
      importSource: true,
      remoteListingState: true,
    },
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
      const failure = fetched.failure;
      if (failure.outcome === "RETRY" || CONNECTION_LEVEL_FAILURES.has(failure.errorClass)) {
        return failure;
      }
      await prisma.etsyListingLink.update({
        where: { id: link.id },
        data: {
          readiness: "ACTION_REQUIRED",
          contentHealth: "DEGRADED",
          issueCode: "LISTING_POLL_FAILED",
          issueMessage: (failure.errorMessage || "Etsy listing poll failed").slice(0, 500),
        },
      });
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await applyEtsyListingContentInbound(tx, {
        connectionId: connection.id,
        memberId: connection.memberId,
        listingLinkId: link.id,
        remote: fetched.remote,
        now: deps.now,
      });
      await applyEtsyListingInventoryInbound(tx, {
        connectionId: connection.id,
        memberId: connection.memberId,
        listingLinkId: link.id,
        etsyListingId: link.etsyListingId,
        variants: fetched.remote.variants.map((v) => ({
          etsyOfferingId: v.etsyOfferingId,
          quantity: v.quantity ?? null,
        })),
        now: deps.now,
      });
    });

    // Size×Color: when INW ACTIVE variants and Etsy products diverge, remesh/push via cron.
    const activeVariantCount = await prisma.storeVariant.count({
      where: {
        storeItemId: link.storeItemId,
        memberId: connection.memberId,
        status: "ACTIVE",
      },
    });
    const mapCount = await prisma.etsyVariantMap.count({
      where: { etsyListingLinkId: link.id, etsyConnectionId: connection.id },
    });
    const remoteProductCount = new Set(fetched.remote.variants.map((v) => v.etsyProductId)).size;
    if (
      activeVariantCount > 1 &&
      (mapCount !== activeVariantCount || remoteProductCount !== activeVariantCount)
    ) {
      const storeItem = await prisma.storeItem.findFirst({
        where: { id: link.storeItemId, memberId: connection.memberId },
        select: {
          inventoryTracking: true,
          etsyTaxonomyId: true,
          etsyWhoMade: true,
          etsyWhenMade: true,
          etsyIsSupply: true,
        },
      });
      if (storeItem) {
        const how = resolveEtsyHowItsMadeForCreate({
          etsyWhoMade: storeItem.etsyWhoMade,
          etsyWhenMade: storeItem.etsyWhenMade,
          etsyIsSupply: storeItem.etsyIsSupply,
          etsyTaxonomyId: sanitizeEtsyTaxonomyId(storeItem.etsyTaxonomyId),
          defaultTaxonomyId: resolveEtsyTaxonomyFallback(connection.defaultTaxonomyId),
          inventoryTracking: storeItem.inventoryTracking,
        });
        if (how.ok) {
          const readiness = await resolveEtsyReadinessStateId({
            connectionId: connection.id,
            memberId: connection.memberId,
            shopId: connection.shopId,
            whenMade: how.whenMade,
            inventoryTracking: storeItem.inventoryTracking,
            fetchImpl: deps.fetchImpl,
            now: deps.now,
          });
          if (readiness.ok) {
            const synced = await syncEtsyListingVariantTopology({
              connectionId: connection.id,
              memberId: connection.memberId,
              listingLinkId: link.id,
              storeItemId: link.storeItemId,
              etsyListingId: link.etsyListingId,
              taxonomyId: how.taxonomyId,
              readinessStateId: readiness.readinessStateId,
              inventoryTracking: storeItem.inventoryTracking,
              fetchImpl: deps.fetchImpl,
              now: deps.now,
            });
            if (isSyncEtsyVariantTopologyFailure(synced) && synced.outcome === "RETRY") {
              return synced;
            }
          }
        }
      }
    }

    // NATIVE drafts: re-queue create so photos upload and listing goes live.
    const remoteState = String(fetched.remote.state ?? link.remoteListingState ?? "")
      .trim()
      .toLowerCase();
    if (link.importSource === "NATIVE" && remoteState && remoteState !== "active") {
      const variants = await prisma.storeVariant.findMany({
        where: {
          storeItemId: link.storeItemId,
          memberId: connection.memberId,
          status: "ACTIVE",
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: 400,
      });
      if (variants.length >= 1) {
        try {
          await enqueueEtsySyncJob(prisma, {
            etsyConnectionId: connection.id,
            kind: "CREATE_LISTING",
            dedupeKey: createListingDedupeKey(connection.id, link.storeItemId),
            payload: {
              storeItemId: link.storeItemId,
              storeVariantId: variants[0]!.id,
              storeVariantIds: variants.map((v) => v.id),
            },
          });
        } catch {
          // Conflict / duplicate payload — already queued.
        }
      }
    }
  }

  await markEtsyListingContentPollComplete(prisma, {
    connectionId: connection.id,
    now: deps.now,
  });
  return { outcome: "SUCCESS" };
}
