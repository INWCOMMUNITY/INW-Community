import type { Prisma, PrismaClient } from "@prisma/client";
import { classifyEtsyContentSemantics } from "./content-semantic";
import {
  etsyProductContentFingerprint,
  etsyVariantContentFingerprint,
  normalizeEtsyDescription,
  normalizeEtsyPhotoUrls,
  normalizeEtsyTitle,
} from "./content-fingerprint";
import { ensureEtsyUpdateListingContentJob } from "./content-desire";
import { recordShopifyListingContentDesire } from "../shopify/content-desire";
import { optionFingerprint } from "../foundation/backfill/analyze";

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
    /** Size×Color (etc.) option combination from property_values. */
    options?: Record<string, string> | null;
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

function parseStoreVariantOptionsJson(raw: unknown): Record<string, string> | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const name = String(k ?? "").trim();
    const val = v == null ? "" : String(v).trim();
    if (!name || !val) continue;
    out[name] = val;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Axis-name-independent match key (Color vs Primary color). */
function optionValuesKey(options: Record<string, string>): string {
  return Object.values(options)
    .map((v) => String(v ?? "").trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .join("\u0001");
}

/**
 * When Etsy product/offering ids drift but Size×Color options still match INW,
 * rewrite map ids so price/qty inbound keeps working.
 */
async function rematchVariantMapsByOptions(
  db: EtsyInboundDb,
  input: {
    variantMaps: Array<{
      id: string;
      storeVariantId: string;
      etsyProductId: string;
      etsyOfferingId: string;
    }>;
    storeVariants: Array<{ id: string; options: unknown }>;
    remoteVariants: EtsyRemoteListingObservation["variants"];
  }
): Promise<number> {
  const byStoreId = new Map(input.storeVariants.map((v) => [v.id, v]));
  const remoteByOffering = new Map(input.remoteVariants.map((v) => [v.etsyOfferingId, v]));
  const remoteByCombo = new Map<string, (typeof input.remoteVariants)[number]>();
  const remoteByValues = new Map<string, (typeof input.remoteVariants)[number]>();
  for (const remote of input.remoteVariants) {
    if (!remote.options || Object.keys(remote.options).length < 1) continue;
    remoteByCombo.set(optionFingerprint(remote.options), remote);
    const valuesKey = optionValuesKey(remote.options);
    if (valuesKey && !remoteByValues.has(valuesKey)) {
      remoteByValues.set(valuesKey, remote);
    }
  }
  let rematched = 0;
  for (const map of input.variantMaps) {
    if (remoteByOffering.has(map.etsyOfferingId)) continue;
    const storeVariant = byStoreId.get(map.storeVariantId);
    if (!storeVariant) continue;
    const localOpts = parseStoreVariantOptionsJson(storeVariant.options);
    if (!localOpts) continue;
    const remote =
      remoteByCombo.get(optionFingerprint(localOpts)) ??
      remoteByValues.get(optionValuesKey(localOpts));
    if (!remote) continue;
    if (remote.etsyProductId === map.etsyProductId && remote.etsyOfferingId === map.etsyOfferingId) {
      continue;
    }
    await db.etsyVariantMap.update({
      where: { id: map.id },
      data: {
        etsyProductId: remote.etsyProductId,
        etsyOfferingId: remote.etsyOfferingId,
        propertyValuesJson: Object.entries(remote.options ?? {}).map(([property_name, value]) => ({
          property_name,
          values: [value],
        })),
        remoteSku: remote.sku,
      },
    });
    map.etsyProductId = remote.etsyProductId;
    map.etsyOfferingId = remote.etsyOfferingId;
    rematched += 1;
  }
  return rematched;
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

  const storeVariantsForRematch = await db.storeVariant.findMany({
    where: {
      id: { in: variantMaps.map((m) => m.storeVariantId) },
      storeItemId: listing.storeItemId,
      memberId: input.memberId,
    },
    select: { id: true, options: true },
  });
  await rematchVariantMapsByOptions(db, {
    variantMaps,
    storeVariants: storeVariantsForRematch,
    remoteVariants: input.remote.variants,
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
  // When desire is ahead of applied, LWW uses desire fingerprint. When synced, classify
  // against canonical StoreItem so a stale desire fingerprint cannot mask Etsy edits.
  const desireAhead =
    listing.desiredProductContentVersion > listing.appliedProductContentVersion;
  const desiredProductFp = desireAhead
    ? (listing.desiredProductFingerprint ?? localProductFp)
    : localProductFp;
  const productClass = classifyEtsyContentSemantics({
    base: listing.appliedProductFingerprint,
    local: desiredProductFp,
    remote: remoteProductFp,
    hasLocalSemanticEdit: desireAhead,
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
    const remoteTitle = normalizeEtsyTitle(input.remote.title).slice(0, 140);
    const remoteDescription = normalizeEtsyDescription(input.remote.description);
    await db.storeItem.update({
      where: { id: storeItem.id },
      data: {
        title: remoteTitle || storeItem.title,
        // Empty Etsy description clears INW description (null), matching StoreItem nullability.
        description: remoteDescription.length > 0 ? remoteDescription : null,
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
  } else if (productClass === "LOCAL_ONLY") {
    // INW title/desc ahead of Etsy — keep observing and re-queue outbound so cron pushes.
    await db.etsyListingLink.update({
      where: { id: listing.id },
      data: {
        lastObservedProductFingerprint: remoteProductFp,
        lastObservedProductUpdatedAt: now,
      },
    });
    if (
      listing.desiredProductContentVersion > listing.appliedProductContentVersion &&
      variantMaps[0]
    ) {
      await ensureEtsyUpdateListingContentJob(db, {
        connectionId: input.connectionId,
        storeItemId: listing.storeItemId,
        storeVariantId: variantMaps[0]!.storeVariantId,
        productDesiredVersion: listing.desiredProductContentVersion,
        variantDesiredVersion: variantMaps[0]!.desiredVariantContentVersion,
      }).catch(() => undefined);
    }
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
    const variantDesireAhead =
      map.desiredVariantContentVersion > map.appliedVariantContentVersion;
    const desiredVariantFp = variantDesireAhead
      ? (map.desiredVariantFingerprint ?? localVariantFp)
      : localVariantFp;
    const variantClass = classifyEtsyContentSemantics({
      base: map.appliedVariantFingerprint,
      local: desiredVariantFp,
      remote: remoteVariantFp,
      hasLocalSemanticEdit: variantDesireAhead,
    });
    variantClasses.push(variantClass);
    if (variantClass === "CONFLICT") anyConflict = true;

    if (variantClass === "REMOTE_ONLY") {
      const nextPrice =
        Number.isFinite(remoteVariant.priceCents) && remoteVariant.priceCents > 0
          ? Math.round(remoteVariant.priceCents)
          : storeVariant.priceCents;
      const remoteOptions =
        remoteVariant.options && Object.keys(remoteVariant.options).length > 0
          ? remoteVariant.options
          : null;
      const localOptions = parseStoreVariantOptionsJson(storeVariant.options);
      const optionsChanged =
        remoteOptions != null &&
        (localOptions == null ||
          optionFingerprint(localOptions) !== optionFingerprint(remoteOptions));
      await db.storeVariant.update({
        where: { id: storeVariant.id },
        data: {
          priceCents: nextPrice,
          sku: remoteVariant.sku,
          ...(optionsChanged ? { options: remoteOptions } : {}),
        },
      });
      // Keep StoreItem scalar facade in sync for single-variant listings.
      if (variantMaps.length === 1) {
        await db.storeItem.update({
          where: { id: storeItem.id },
          data: {
            priceCents: nextPrice,
            sku: remoteVariant.sku,
          },
        });
      }
      appliedRemoteVariant = true;
    } else if (
      (variantClass === "CONVERGED" || variantClass === "UNCHANGED") &&
      remoteVariant.options &&
      Object.keys(remoteVariant.options).length > 0
    ) {
      // Price/SKU already match — still pull Size×Color option labels when Etsy renamed values.
      const localOptions = parseStoreVariantOptionsJson(storeVariant.options);
      if (
        localOptions == null ||
        optionFingerprint(localOptions) !== optionFingerprint(remoteVariant.options)
      ) {
        await db.storeVariant.update({
          where: { id: storeVariant.id },
          data: { options: remoteVariant.options },
        });
        appliedRemoteVariant = true;
      }
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
    } else if (variantClass === "LOCAL_ONLY") {
      // INW price/SKU ahead of Etsy — re-queue outbound so cron pushes.
      await db.etsyVariantMap.update({
        where: { id: map.id },
        data: {
          lastObservedVariantFingerprint: remoteVariantFp,
          lastObservedVariantUpdatedAt: now,
        },
      });
      if (map.desiredVariantContentVersion > map.appliedVariantContentVersion) {
        await ensureEtsyUpdateListingContentJob(db, {
          connectionId: input.connectionId,
          storeItemId: listing.storeItemId,
          storeVariantId: map.storeVariantId,
          productDesiredVersion: listing.desiredProductContentVersion,
          variantDesiredVersion: map.desiredVariantContentVersion,
        }).catch(() => undefined);
      }
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
