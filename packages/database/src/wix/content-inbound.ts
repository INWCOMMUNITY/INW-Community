import type { Prisma, PrismaClient } from "@prisma/client";
import { recordEtsyListingContentDesire } from "../etsy/content-desire";
import { recordShopifyListingContentDesire } from "../shopify/content-desire";
import { ensureWixUpdateListingContentJob } from "./content-desire";
import {
  normalizeWixDescription,
  normalizeWixPhotoUrls,
  normalizeWixTitle,
  wixProductContentFingerprint,
  wixVariantContentFingerprint,
} from "./content-fingerprint";
import { classifyWixContentSemantics } from "./content-semantic";

export type WixInboundDb = PrismaClient | Prisma.TransactionClient;

export type WixRemoteListingObservation = {
  wixProductId: string;
  title: string;
  description: string | null;
  photos: string[];
  priceCents: number;
  visible?: boolean | null;
  variants: Array<{
    wixVariantId: string;
    priceCents: number;
    sku: string | null;
  }>;
};

export type ApplyWixListingInboundResult =
  | {
      status: "APPLIED" | "OBSERVED" | "CONFLICT" | "PAUSED";
      productClass: string;
      shopifyDesireRecorded: boolean;
      etsyDesireRecorded: boolean;
    }
  | { status: "SKIPPED"; reason: string };

function inboundLockKey(listingLinkId: string): string {
  return `wix-content-inbound:${listingLinkId}`;
}

/**
 * Apply a re-read Wix product observation using three-way fingerprint classification.
 * Echoes (LOCAL_ONLY / CONVERGED) never rewrite StoreItem from Wix.
 * REMOTE_ONLY updates canonical INW and fans out to Shopify/Etsy desire hooks.
 * Never enqueues Wix outbound desire for REMOTE_ONLY (would loop).
 */
export async function applyWixListingContentInbound(
  db: WixInboundDb,
  input: {
    connectionId: string;
    memberId: string;
    listingLinkId: string;
    remote: WixRemoteListingObservation;
    now?: Date;
  }
): Promise<ApplyWixListingInboundResult> {
  const now = input.now ?? new Date();
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${inboundLockKey(input.listingLinkId)}))`;

  const listing = await db.wixListingLink.findFirst({
    where: {
      id: input.listingLinkId,
      wixConnectionId: input.connectionId,
      memberId: input.memberId,
    },
  });
  if (!listing) return { status: "SKIPPED", reason: "LISTING_MISSING" };
  if (listing.wixProductId !== input.remote.wixProductId) {
    return { status: "SKIPPED", reason: "PRODUCT_ID_MISMATCH" };
  }

  if (listing.contentHealth === "PAUSED") {
    return {
      status: "PAUSED",
      productClass: "PAUSED",
      shopifyDesireRecorded: false,
      etsyDesireRecorded: false,
    };
  }

  const storeItem = await db.storeItem.findFirst({
    where: { id: listing.storeItemId, memberId: input.memberId },
  });
  if (!storeItem) return { status: "SKIPPED", reason: "STORE_ITEM_MISSING" };

  const localPhotos = normalizeWixPhotoUrls(storeItem.photos);
  const remotePhotos = normalizeWixPhotoUrls(input.remote.photos);
  const localProductFp = wixProductContentFingerprint({
    title: storeItem.title,
    description: storeItem.description,
    photos: localPhotos,
    priceCents: storeItem.priceCents,
  });
  const remoteProductFp = wixProductContentFingerprint({
    title: input.remote.title,
    description: input.remote.description,
    photos: remotePhotos,
    priceCents: input.remote.priceCents,
  });

  const desireAhead =
    listing.desiredProductContentVersion > listing.appliedProductContentVersion;
  const desiredProductFp = desireAhead
    ? (listing.desiredProductFingerprint ?? localProductFp)
    : localProductFp;
  const productClass = classifyWixContentSemantics({
    base: listing.appliedProductFingerprint,
    local: desiredProductFp,
    remote: remoteProductFp,
    hasLocalSemanticEdit: desireAhead,
  });

  const contentBefore = {
    title: storeItem.title,
    description: storeItem.description,
    priceCents: storeItem.priceCents,
    sku: storeItem.sku,
    photos: storeItem.photos,
  };

  let appliedRemoteProduct = false;
  if (productClass === "REMOTE_ONLY") {
    const remoteTitle = normalizeWixTitle(input.remote.title).slice(0, 140);
    const remoteDescription = normalizeWixDescription(input.remote.description);
    await db.storeItem.update({
      where: { id: storeItem.id },
      data: {
        title: remoteTitle || storeItem.title,
        description: remoteDescription.length > 0 ? remoteDescription : null,
        photos: remotePhotos.length > 0 ? remotePhotos : storeItem.photos,
        priceCents: input.remote.priceCents > 0 ? input.remote.priceCents : storeItem.priceCents,
      },
    });
    appliedRemoteProduct = true;
  }

  if (productClass === "CONVERGED" || productClass === "REMOTE_ONLY") {
    await db.wixListingLink.update({
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
        ...(input.remote.visible != null ? { remoteProductVisible: input.remote.visible } : {}),
      },
    });
  } else if (productClass === "CONFLICT") {
    await db.wixListingLink.update({
      where: { id: listing.id },
      data: {
        lastObservedProductFingerprint: remoteProductFp,
        lastObservedProductUpdatedAt: now,
        productContentConflict: true,
        productConflictRemoteFingerprint: remoteProductFp,
        productConflictDetectedAt: now,
        contentHealth: "DEGRADED",
        readiness: "ACTION_REQUIRED",
        issueCode: "CONTENT_CONFLICT",
        issueMessage:
          "INW and Wix both changed this listing. Edit on INW to choose the version you want.",
        issueSeverity: "warning",
        issueFirstSeenAt: listing.issueFirstSeenAt ?? now,
        issueLastSeenAt: now,
        ...(input.remote.visible != null ? { remoteProductVisible: input.remote.visible } : {}),
      },
    });
  } else if (productClass === "LOCAL_ONLY") {
    await db.wixListingLink.update({
      where: { id: listing.id },
      data: {
        lastObservedProductFingerprint: remoteProductFp,
        lastObservedProductUpdatedAt: now,
        ...(input.remote.visible != null ? { remoteProductVisible: input.remote.visible } : {}),
      },
    });
    if (desireAhead) {
      await ensureWixUpdateListingContentJob(db, {
        listingLinkId: listing.id,
        wixConnectionId: input.connectionId,
      }).catch(() => undefined);
    }
  } else {
    await db.wixListingLink.update({
      where: { id: listing.id },
      data: {
        lastObservedProductFingerprint: remoteProductFp,
        lastObservedProductUpdatedAt: now,
        ...(input.remote.visible != null ? { remoteProductVisible: input.remote.visible } : {}),
      },
    });
  }

  // Apply remote variant price/sku when mapped and remote-only vs applied baseline.
  const variantMaps = await db.wixVariantMap.findMany({
    where: { wixListingLinkId: listing.id, wixConnectionId: input.connectionId },
  });
  const remoteByVariant = new Map(input.remote.variants.map((v) => [v.wixVariantId, v]));
  for (const map of variantMaps) {
    const remote = remoteByVariant.get(map.wixVariantId);
    if (!remote) continue;
    const storeVariant = await db.storeVariant.findFirst({
      where: { id: map.storeVariantId, storeItemId: listing.storeItemId, memberId: input.memberId },
    });
    if (!storeVariant) continue;

    const localFp = wixVariantContentFingerprint({
      priceCents: storeVariant.priceCents ?? storeItem.priceCents,
      sku: storeVariant.sku,
    });
    const remoteFp = wixVariantContentFingerprint({
      priceCents: remote.priceCents,
      sku: remote.sku,
    });
    const desireAheadVariant =
      map.desiredVariantContentVersion > map.appliedVariantContentVersion;
    const desiredFp = desireAheadVariant
      ? (map.desiredVariantFingerprint ?? localFp)
      : localFp;
    const variantClass = classifyWixContentSemantics({
      base: map.appliedVariantFingerprint,
      local: desiredFp,
      remote: remoteFp,
      hasLocalSemanticEdit: desireAheadVariant,
    });

    if (variantClass === "REMOTE_ONLY") {
      await db.storeVariant.update({
        where: { id: storeVariant.id },
        data: {
          priceCents: remote.priceCents > 0 ? remote.priceCents : storeVariant.priceCents,
          sku: remote.sku?.trim() || storeVariant.sku,
        },
      });
      appliedRemoteProduct = true;
    }
    if (variantClass === "CONVERGED" || variantClass === "REMOTE_ONLY") {
      await db.wixVariantMap.update({
        where: { id: map.id },
        data: {
          appliedVariantContentVersion: Math.max(
            map.appliedVariantContentVersion,
            map.desiredVariantContentVersion
          ),
          appliedVariantFingerprint: remoteFp,
          desiredVariantFingerprint: remoteFp,
          variantContentAppliedAt: now,
          remoteSku: remote.sku,
        },
      });
    }
  }

  let shopifyDesireRecorded = false;
  let etsyDesireRecorded = false;
  if (appliedRemoteProduct) {
    const after = await db.storeItem.findUniqueOrThrow({ where: { id: storeItem.id } });
    const afterSnapshot = {
      title: after.title,
      description: after.description,
      priceCents: after.priceCents,
      sku: after.sku,
      photos: after.photos,
    };
    const shopify = await recordShopifyListingContentDesire(db, {
      memberId: input.memberId,
      storeItemId: storeItem.id,
      before: contentBefore,
      after: afterSnapshot,
    });
    shopifyDesireRecorded = shopify.status === "RECORDED";
    const etsy = await recordEtsyListingContentDesire(db, {
      memberId: input.memberId,
      storeItemId: storeItem.id,
      before: contentBefore,
      after: afterSnapshot,
    });
    etsyDesireRecorded = etsy.status === "RECORDED";
  }

  if (productClass === "CONFLICT") {
    return {
      status: "CONFLICT",
      productClass,
      shopifyDesireRecorded,
      etsyDesireRecorded,
    };
  }
  if (appliedRemoteProduct) {
    return {
      status: "APPLIED",
      productClass,
      shopifyDesireRecorded,
      etsyDesireRecorded,
    };
  }
  return {
    status: "OBSERVED",
    productClass,
    shopifyDesireRecorded,
    etsyDesireRecorded,
  };
}
