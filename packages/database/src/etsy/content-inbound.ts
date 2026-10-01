import type { Prisma, PrismaClient } from "@prisma/client";
import { classifyEtsyContentSemantics } from "./content-semantic";
import {
  etsyProductContentFingerprint,
  etsyVariantContentFingerprint,
  normalizeEtsyPhotoUrls,
} from "./content-fingerprint";
import { recordShopifyListingContentDesire } from "../shopify/content-desire";

export type EtsyInboundDb = PrismaClient | Prisma.TransactionClient;

export type EtsyRemoteListingObservation = {
  etsyListingId: string;
  title: string;
  description: string | null;
  photos: string[];
  /** Etsy listing state (active, draft, …) when observed. */
  state?: string | null;
  /** Diagnostic only. */
  updatedAt?: Date | null;
  variants: Array<{
    etsyProductId: string;
    etsyOfferingId: string;
    priceCents: number;
    sku: string | null;
    /** Sellable quantity on the Etsy offering when present in inventory GET. */
    quantity?: number | null;
  }>;
};

export type ApplyEtsyListingInboundResult =
  | {
      status: "APPLIED" | "OBSERVED" | "CONFLICT" | "PAUSED";
      productClass: string;
      variantClasses: string[];
      shopifyDesireRecorded: boolean;
    }
  | { status: "SKIPPED"; reason: string };

function inboundLockKey(listingLinkId: string): string {
  return `etsy-content-inbound:${listingLinkId}`;
}

/**
 * Apply a re-read Etsy listing observation using three-way fingerprint classification.
 * Echoes (LOCAL_ONLY / CONVERGED matching outbound desire) never rewrite StoreItem.
 * REMOTE_ONLY updates canonical INW and fans out to Shopify desire hooks.
 * Never enqueues Etsy outbound desire (would loop).
 */
export async function applyEtsyListingContentInbound(
  db: EtsyInboundDb,
  input: {
    connectionId: string;
    memberId: string;
    listingLinkId: string;
    remote: EtsyRemoteListingObservation;
    now?: Date;
  }
): Promise<ApplyEtsyListingInboundResult> {
  const now = input.now ?? new Date();
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${inboundLockKey(input.listingLinkId)}))`;

  const listing = await db.etsyListingLink.findFirst({
    where: {
      id: input.listingLinkId,
      etsyConnectionId: input.connectionId,
      memberId: input.memberId,
    },
  });
  if (!listing) return { status: "SKIPPED", reason: "LISTING_MISSING" };
  if (listing.etsyListingId !== input.remote.etsyListingId) {
    return { status: "SKIPPED", reason: "LISTING_ID_MISMATCH" };
  }

  const observedState = String(input.remote.state ?? "")
    .trim()
    .toLowerCase();
  if (observedState && observedState !== String(listing.remoteListingState ?? "").toLowerCase()) {
    await db.etsyListingLink.update({
      where: { id: listing.id },
      data:
        observedState === "active"
          ? {
              remoteListingState: "active",
              ...(listing.issueCode === "DRAFT_NOT_ACTIVE" || listing.issueCode === "ACTIVATE_FAILED"
                ? {
                    readiness: "READY_TO_PUBLISH" as const,
                    contentHealth: "HEALTHY" as const,
                    issueCode: null,
                    issueMessage: null,
                  }
                : {}),
            }
          : {
              remoteListingState: observedState,
              readiness: "ACTION_REQUIRED" as const,
              contentHealth: "DEGRADED" as const,
              issueCode: "DRAFT_NOT_ACTIVE",
              issueMessage:
                "Etsy listing is still a draft (not live). Re-list from Apps Airport to upload photos and publish.",
            },
    });
    listing.remoteListingState = observedState;
  }

  if (listing.contentHealth === "PAUSED") {
    return {
      status: "PAUSED",
      productClass: "PAUSED",
      variantClasses: [],
      shopifyDesireRecorded: false,
    };
  }

  const storeItem = await db.storeItem.findFirst({
    where: { id: listing.storeItemId, memberId: input.memberId },
  });
  if (!storeItem) return { status: "SKIPPED", reason: "STORE_ITEM_MISSING" };

  const variantMaps = await db.etsyVariantMap.findMany({
    where: { etsyListingLinkId: listing.id, etsyConnectionId: input.connectionId },
    orderBy: { createdAt: "asc" },
  });

  const localPhotos = normalizeEtsyPhotoUrls(storeItem.photos);
  const remotePhotos = normalizeEtsyPhotoUrls(input.remote.photos);
  const localProductFp = etsyProductContentFingerprint({
    title: storeItem.title,
    description: storeItem.description,
    photos: localPhotos,
  });
  const remoteProductFp = etsyProductContentFingerprint({
    title: input.remote.title,
    description: input.remote.description,
    photos: remotePhotos,
  });
  const desiredProductFp = listing.desiredProductFingerprint ?? localProductFp;
  const productClass = classifyEtsyContentSemantics({
    base: listing.appliedProductFingerprint,
    local: desiredProductFp,
    remote: remoteProductFp,
    hasLocalSemanticEdit: listing.desiredProductContentVersion > listing.appliedProductContentVersion,
  });

  const variantClasses: string[] = [];
  let anyConflict = productClass === "CONFLICT";
  let appliedRemoteProduct = false;
  let appliedRemoteVariant = false;

  const contentBefore = {
    title: storeItem.title,
    description: storeItem.description,
    priceCents: storeItem.priceCents,
    sku: storeItem.sku,
    photos: storeItem.photos,
  };

  if (productClass === "REMOTE_ONLY") {
    await db.storeItem.update({
      where: { id: storeItem.id },
      data: {
        title: input.remote.title.trim() || storeItem.title,
        description: input.remote.description,
        photos: remotePhotos,
      },
    });
    appliedRemoteProduct = true;
  }

  if (productClass === "CONVERGED" || productClass === "REMOTE_ONLY") {
    await db.etsyListingLink.update({
      where: { id: listing.id },
      data: {
        appliedProductContentVersion: Math.max(
          listing.appliedProductContentVersion,
          listing.desiredProductContentVersion
        ),
        appliedProductFingerprint: remoteProductFp,
        desiredProductFingerprint: remoteProductFp,
        productContentAppliedAt: now,
        lastObservedProductFingerprint: remoteProductFp,
        lastObservedProductUpdatedAt: now,
        productContentConflict: false,
        productConflictRemoteFingerprint: null,
        productConflictEvidenceId: null,
        productConflictDetectedAt: null,
      },
    });
  } else if (productClass === "CONFLICT") {
    await db.etsyListingLink.update({
      where: { id: listing.id },
      data: {
        lastObservedProductFingerprint: remoteProductFp,
        lastObservedProductUpdatedAt: now,
        productContentConflict: true,
        productConflictRemoteFingerprint: remoteProductFp,
        productConflictDetectedAt: now,
      },
    });
  } else {
    await db.etsyListingLink.update({
      where: { id: listing.id },
      data: {
        lastObservedProductFingerprint: remoteProductFp,
        lastObservedProductUpdatedAt: now,
      },
    });
  }

  const remoteByOffering = new Map(
    input.remote.variants.map((v) => [v.etsyOfferingId, v] as const)
  );

  for (const map of variantMaps) {
    const remoteVariant = remoteByOffering.get(map.etsyOfferingId);
    if (!remoteVariant) {
      variantClasses.push("MISSING_REMOTE");
      continue;
    }
    const storeVariant = await db.storeVariant.findFirst({
      where: { id: map.storeVariantId, storeItemId: listing.storeItemId, memberId: input.memberId },
    });
    if (!storeVariant) {
      variantClasses.push("MISSING_LOCAL");
      continue;
    }

    const localVariantFp = etsyVariantContentFingerprint({
      priceCents: storeVariant.priceCents,
      sku: storeVariant.sku,
    });
    const remoteVariantFp = etsyVariantContentFingerprint({
      priceCents: remoteVariant.priceCents,
      sku: remoteVariant.sku,
    });
    const desiredVariantFp = map.desiredVariantFingerprint ?? localVariantFp;
    const variantClass = classifyEtsyContentSemantics({
      base: map.appliedVariantFingerprint,
      local: desiredVariantFp,
      remote: remoteVariantFp,
      hasLocalSemanticEdit: map.desiredVariantContentVersion > map.appliedVariantContentVersion,
    });
    variantClasses.push(variantClass);
    if (variantClass === "CONFLICT") anyConflict = true;

    if (variantClass === "REMOTE_ONLY") {
      await db.storeVariant.update({
        where: { id: storeVariant.id },
        data: {
          priceCents: remoteVariant.priceCents,
          sku: remoteVariant.sku,
        },
      });
      // Keep StoreItem scalar facade in sync for single-variant listings.
      if (variantMaps.length === 1) {
        await db.storeItem.update({
          where: { id: storeItem.id },
          data: {
            priceCents: remoteVariant.priceCents,
            sku: remoteVariant.sku,
          },
        });
      }
      appliedRemoteVariant = true;
    }

    if (variantClass === "CONVERGED" || variantClass === "REMOTE_ONLY") {
      await db.etsyVariantMap.update({
        where: { id: map.id },
        data: {
          appliedVariantContentVersion: Math.max(
            map.appliedVariantContentVersion,
            map.desiredVariantContentVersion
          ),
          appliedVariantFingerprint: remoteVariantFp,
          desiredVariantFingerprint: remoteVariantFp,
          variantContentAppliedAt: now,
          lastObservedVariantFingerprint: remoteVariantFp,
          lastObservedVariantUpdatedAt: now,
          remoteSku: remoteVariant.sku,
          variantContentConflict: false,
          variantConflictRemoteFingerprint: null,
          variantConflictEvidenceId: null,
          variantConflictDetectedAt: null,
        },
      });
    } else if (variantClass === "CONFLICT") {
      await db.etsyVariantMap.update({
        where: { id: map.id },
        data: {
          lastObservedVariantFingerprint: remoteVariantFp,
          lastObservedVariantUpdatedAt: now,
          variantContentConflict: true,
          variantConflictRemoteFingerprint: remoteVariantFp,
          variantConflictDetectedAt: now,
        },
      });
    } else {
      await db.etsyVariantMap.update({
        where: { id: map.id },
        data: {
          lastObservedVariantFingerprint: remoteVariantFp,
          lastObservedVariantUpdatedAt: now,
        },
      });
    }
  }

  let shopifyDesireRecorded = false;
  if (appliedRemoteProduct || appliedRemoteVariant) {
    const updated = await db.storeItem.findUniqueOrThrow({ where: { id: storeItem.id } });
    const shopify = await recordShopifyListingContentDesire(db, {
      memberId: input.memberId,
      storeItemId: storeItem.id,
      before: contentBefore,
      after: {
        title: updated.title,
        description: updated.description,
        priceCents: updated.priceCents,
        sku: updated.sku,
        photos: updated.photos,
      },
    });
    shopifyDesireRecorded = shopify.status === "RECORDED";
  }

  if (anyConflict) {
    return {
      status: "CONFLICT",
      productClass,
      variantClasses,
      shopifyDesireRecorded,
    };
  }
  if (appliedRemoteProduct || appliedRemoteVariant) {
    return {
      status: "APPLIED",
      productClass,
      variantClasses,
      shopifyDesireRecorded,
    };
  }
  return {
    status: "OBSERVED",
    productClass,
    variantClasses,
    shopifyDesireRecorded,
  };
}

export type { Prisma };
