import type { Prisma, PrismaClient, ShopifyProviderEvidence } from "@prisma/client";
import {
  clearShopifyProductContentConflict,
  clearShopifyVariantContentConflict,
  ensureShopifyUpdateListingContentJob,
  markShopifyProductContentApplied,
  markShopifyVariantContentApplied,
  setShopifyProductContentConflict,
  setShopifyVariantContentConflict,
} from "./content-desire";
import {
  shopifyCentsFromMoneyString,
  shopifyProductContentFingerprint,
  shopifyVariantContentFingerprint,
} from "./content-fingerprint";
import { classifyShopifyContentSemantics } from "./content-semantic";

export type ShopifyInboundDb = PrismaClient | Prisma.TransactionClient;

export type ShopifyRemoteProductObservation = {
  productId: string;
  status: string;
  title: string;
  descriptionHtml: string | null;
  /** Diagnostic only — never used for winner selection. */
  updatedAt: Date;
  variants: Array<{
    id: string;
    price: string;
    sku: string | null;
    /** Diagnostic only — never used for winner selection. */
    updatedAt: Date;
    inventoryItemId: string | null;
  }>;
};

export type ApplyShopifyProductsUpdateResult =
  | { status: "PROCESSED"; productAction: string; variantAction: string }
  | { status: "IGNORED"; reason: string }
  | { status: "ERROR"; code: string; message: string };

function contentInboundLockKey(listingLinkId: string): string {
  return `shopify-content-inbound:${listingLinkId}`;
}

function markEvidence(
  db: ShopifyInboundDb,
  evidenceId: string,
  state: "PROCESSED" | "IGNORED" | "ERROR",
  error?: { code: string; message: string }
) {
  return db.shopifyProviderEvidence.update({
    where: { id: evidenceId },
    data: {
      processState: state,
      processedAt: new Date(),
      lastErrorCode: error?.code ?? null,
      lastErrorMessage: error?.message ?? null,
    },
  });
}

/**
 * Apply a re-read Shopify product observation using three-way semantic classification.
 * Fingerprints only for winner selection — never Product/Variant.updatedAt.
 */
export async function applyShopifyProductsUpdateObservation(
  db: PrismaClient,
  input: {
    evidenceId: string;
    connectionId: string;
    listingLinkId: string;
    mappedVariantId: string;
    mappedStoreVariantId: string;
    remote: ShopifyRemoteProductObservation;
  }
): Promise<ApplyShopifyProductsUpdateResult> {
  const existing = await db.shopifyProviderEvidence.findUnique({ where: { id: input.evidenceId } });
  if (!existing) {
    return { status: "ERROR", code: "EVIDENCE_NOT_FOUND", message: "Provider evidence missing" };
  }
  if (existing.processState === "PROCESSED") {
    return {
      status: "PROCESSED",
      productAction: "ALREADY_PROCESSED",
      variantAction: "ALREADY_PROCESSED",
    };
  }
  if (existing.processState === "IGNORED") {
    return { status: "IGNORED", reason: existing.lastErrorCode ?? "ALREADY_IGNORED" };
  }
  if (existing.processState === "ERROR") {
    return {
      status: "ERROR",
      code: existing.lastErrorCode ?? "ALREADY_ERROR",
      message: existing.lastErrorMessage ?? "Evidence already in ERROR",
    };
  }
  if (existing.shopifyConnectionId !== input.connectionId) {
    await markEvidence(db, input.evidenceId, "ERROR", {
      code: "GENERATION_MISMATCH",
      message: "Evidence connection does not match apply connection",
    });
    return { status: "ERROR", code: "GENERATION_MISMATCH", message: "Evidence connection mismatch" };
  }

  if (String(input.remote.status).toUpperCase() !== "DRAFT") {
    await markEvidence(db, input.evidenceId, "ERROR", {
      code: "PRODUCT_NOT_DRAFT",
      message: "Mapped Shopify product is not DRAFT; refusing inbound content import",
    });
    return {
      status: "ERROR",
      code: "PRODUCT_NOT_DRAFT",
      message: "Mapped Shopify product is not DRAFT",
    };
  }

  if (input.remote.variants.length !== 1) {
    await markEvidence(db, input.evidenceId, "ERROR", {
      code: "VARIANT_CARDINALITY",
      message: `Expected exactly one Shopify variant, found ${input.remote.variants.length}`,
    });
    return {
      status: "ERROR",
      code: "VARIANT_CARDINALITY",
      message: "Mapped listing no longer has exactly one Shopify variant",
    };
  }
  const remoteVariant = input.remote.variants[0];
  if (remoteVariant.id !== input.mappedVariantId) {
    await markEvidence(db, input.evidenceId, "ERROR", {
      code: "VARIANT_GID_MISMATCH",
      message: "Remote variant identity does not match mapping",
    });
    return { status: "ERROR", code: "VARIANT_GID_MISMATCH", message: "Variant GID mismatch" };
  }
  if (!remoteVariant.inventoryItemId) {
    await markEvidence(db, input.evidenceId, "ERROR", {
      code: "INVENTORY_ITEM_MISSING",
      message: "Mapped Shopify variant is missing inventoryItem",
    });
    return {
      status: "ERROR",
      code: "INVENTORY_ITEM_MISSING",
      message: "Mapped Shopify variant is missing inventoryItem",
    };
  }

  const remotePriceCents = shopifyCentsFromMoneyString(remoteVariant.price);
  if (!Number.isFinite(remotePriceCents)) {
    await markEvidence(db, input.evidenceId, "ERROR", {
      code: "REMOTE_PRICE_INVALID",
      message: "Remote Shopify variant price could not be parsed",
    });
    return { status: "ERROR", code: "REMOTE_PRICE_INVALID", message: "Invalid remote price" };
  }

  const remoteProductFp = shopifyProductContentFingerprint({
    title: input.remote.title,
    description: input.remote.descriptionHtml,
  });
  const remoteVariantFp = shopifyVariantContentFingerprint({
    priceCents: remotePriceCents,
    sku: remoteVariant.sku,
  });

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${contentInboundLockKey(input.listingLinkId)}))`;

    const listing = await tx.shopifyListingLink.findUnique({ where: { id: input.listingLinkId } });
    const variantMap = await tx.shopifyVariantMap.findFirst({
      where: {
        shopifyListingLinkId: input.listingLinkId,
        shopifyConnectionId: input.connectionId,
        storeVariantId: input.mappedStoreVariantId,
      },
    });
    if (!listing || !variantMap || listing.shopifyConnectionId !== input.connectionId) {
      await markEvidence(tx, input.evidenceId, "ERROR", {
        code: "MAPPING_MISSING",
        message: "Listing mapping disappeared during inbound apply",
      });
      return {
        status: "ERROR" as const,
        code: "MAPPING_MISSING",
        message: "Listing mapping disappeared during inbound apply",
      };
    }

    const storeItem = await tx.storeItem.findFirst({
      where: { id: listing.storeItemId, memberId: listing.memberId },
    });
    const storeVariant = await tx.storeVariant.findFirst({
      where: {
        id: variantMap.storeVariantId,
        storeItemId: listing.storeItemId,
        memberId: listing.memberId,
      },
    });
    if (!storeItem || !storeVariant) {
      await markEvidence(tx, input.evidenceId, "ERROR", {
        code: "STORE_ITEM_UNAVAILABLE",
        message: "Canonical store item/variant unavailable",
      });
      return {
        status: "ERROR" as const,
        code: "STORE_ITEM_UNAVAILABLE",
        message: "Canonical store item/variant unavailable",
      };
    }

    const localProductFp =
      listing.desiredProductFingerprint ??
      shopifyProductContentFingerprint({
        title: storeItem.title,
        description: storeItem.description,
      });
    const localVariantFp =
      variantMap.desiredVariantFingerprint ??
      shopifyVariantContentFingerprint({
        priceCents: storeVariant.priceCents,
        sku: storeVariant.sku,
      });

    const productBase = listing.appliedProductFingerprint;
    const variantBase = variantMap.appliedVariantFingerprint;
    const hasLocalProductEdit =
      listing.desiredProductContentVersion > 0 || listing.productDesiredAt != null;
    const hasLocalVariantEdit =
      variantMap.desiredVariantContentVersion > 0 || variantMap.variantDesiredAt != null;

    let productAction = "NONE";
    let variantAction = "NONE";

    // ---- PRODUCT group (fingerprints only) ----
    const productClass = classifyShopifyContentSemantics({
      base: productBase,
      local: localProductFp,
      remote: remoteProductFp,
      hasLocalSemanticEdit: hasLocalProductEdit,
    });

    // Always record diagnostic observation timestamps (not winners).
    const productObservation = {
      lastObservedProductFingerprint: remoteProductFp,
      lastObservedProductUpdatedAt: input.remote.updatedAt,
    };

    if (productClass === "UNCHANGED") {
      await tx.shopifyListingLink.update({
        where: { id: listing.id },
        data: productObservation,
      });
      productAction = "UNCHANGED";
    } else if (productClass === "CONVERGED") {
      await markShopifyProductContentApplied(tx, {
        listingLinkId: listing.id,
        desiredVersion: listing.desiredProductContentVersion,
        fingerprint: remoteProductFp,
      });
      await tx.shopifyListingLink.update({
        where: { id: listing.id },
        data: productObservation,
      });
      productAction = "CONVERGED";
    } else if (productClass === "LOCAL_ONLY") {
      await clearShopifyProductContentConflict(tx, listing.id);
      await tx.shopifyListingLink.update({
        where: { id: listing.id },
        data: productObservation,
      });
      // Ensure durable outbound work for current desired versions (no version bump).
      if (listing.desiredProductContentVersion > listing.appliedProductContentVersion) {
        await ensureShopifyUpdateListingContentJob(tx, {
          connectionId: listing.shopifyConnectionId,
          storeItemId: listing.storeItemId,
          storeVariantId: variantMap.storeVariantId,
          productDesiredVersion: listing.desiredProductContentVersion,
          variantDesiredVersion: variantMap.desiredVariantContentVersion,
        });
      }
      productAction = "LOCAL_ONLY";
    } else if (productClass === "REMOTE_ONLY") {
      const nextVersion = listing.desiredProductContentVersion + 1;
      await tx.storeItem.update({
        where: { id: storeItem.id },
        data: {
          title: input.remote.title,
          description: input.remote.descriptionHtml?.trim() ? input.remote.descriptionHtml : null,
        },
      });
      await tx.shopifyListingLink.update({
        where: { id: listing.id },
        data: {
          desiredProductContentVersion: nextVersion,
          appliedProductContentVersion: nextVersion,
          desiredProductFingerprint: remoteProductFp,
          appliedProductFingerprint: remoteProductFp,
          productDesiredAt: new Date(),
          productContentAppliedAt: new Date(),
          productContentConflict: false,
          productConflictRemoteFingerprint: null,
          productConflictEvidenceId: null,
          productConflictDetectedAt: null,
          ...productObservation,
        },
      });
      productAction = "REMOTE_ONLY";
    } else {
      // CONFLICT
      await setShopifyProductContentConflict(tx, {
        listingLinkId: listing.id,
        remoteFingerprint: remoteProductFp,
        evidenceId: input.evidenceId,
      });
      await tx.shopifyListingLink.update({
        where: { id: listing.id },
        data: productObservation,
      });
      productAction = "CONFLICT";
    }

    // ---- VARIANT group ----
    const variantClass = classifyShopifyContentSemantics({
      base: variantBase,
      local: localVariantFp,
      remote: remoteVariantFp,
      hasLocalSemanticEdit: hasLocalVariantEdit,
    });

    const variantObservation = {
      lastObservedVariantFingerprint: remoteVariantFp,
      lastObservedVariantUpdatedAt: remoteVariant.updatedAt,
    };

    // Re-read listing versions after product updates for job enqueue.
    const listingAfterProduct = await tx.shopifyListingLink.findUniqueOrThrow({
      where: { id: listing.id },
    });
    const variantAfterProduct = await tx.shopifyVariantMap.findUniqueOrThrow({
      where: { id: variantMap.id },
    });

    if (variantClass === "UNCHANGED") {
      await tx.shopifyVariantMap.update({
        where: { id: variantMap.id },
        data: variantObservation,
      });
      variantAction = "UNCHANGED";
    } else if (variantClass === "CONVERGED") {
      await markShopifyVariantContentApplied(tx, {
        variantMapId: variantMap.id,
        desiredVersion: variantAfterProduct.desiredVariantContentVersion,
        fingerprint: remoteVariantFp,
      });
      await tx.shopifyVariantMap.update({
        where: { id: variantMap.id },
        data: variantObservation,
      });
      variantAction = "CONVERGED";
    } else if (variantClass === "LOCAL_ONLY") {
      await clearShopifyVariantContentConflict(tx, variantMap.id);
      await tx.shopifyVariantMap.update({
        where: { id: variantMap.id },
        data: variantObservation,
      });
      if (
        variantAfterProduct.desiredVariantContentVersion >
        variantAfterProduct.appliedVariantContentVersion
      ) {
        await ensureShopifyUpdateListingContentJob(tx, {
          connectionId: listingAfterProduct.shopifyConnectionId,
          storeItemId: listingAfterProduct.storeItemId,
          storeVariantId: variantMap.storeVariantId,
          productDesiredVersion: listingAfterProduct.desiredProductContentVersion,
          variantDesiredVersion: variantAfterProduct.desiredVariantContentVersion,
        });
      }
      variantAction = "LOCAL_ONLY";
    } else if (variantClass === "REMOTE_ONLY") {
      const nextVersion = variantAfterProduct.desiredVariantContentVersion + 1;
      const sku = remoteVariant.sku?.trim() ? remoteVariant.sku.trim() : null;
      await tx.storeItem.update({
        where: { id: storeItem.id },
        data: { priceCents: remotePriceCents, sku },
      });
      await tx.storeVariant.update({
        where: { id: storeVariant.id },
        data: { priceCents: remotePriceCents, sku },
      });
      await tx.shopifyVariantMap.update({
        where: { id: variantMap.id },
        data: {
          desiredVariantContentVersion: nextVersion,
          appliedVariantContentVersion: nextVersion,
          desiredVariantFingerprint: remoteVariantFp,
          appliedVariantFingerprint: remoteVariantFp,
          variantDesiredAt: new Date(),
          variantContentAppliedAt: new Date(),
          variantContentConflict: false,
          variantConflictRemoteFingerprint: null,
          variantConflictEvidenceId: null,
          variantConflictDetectedAt: null,
          ...variantObservation,
        },
      });
      variantAction = "REMOTE_ONLY";
    } else {
      await setShopifyVariantContentConflict(tx, {
        variantMapId: variantMap.id,
        remoteFingerprint: remoteVariantFp,
        evidenceId: input.evidenceId,
      });
      await tx.shopifyVariantMap.update({
        where: { id: variantMap.id },
        data: variantObservation,
      });
      variantAction = "CONFLICT";
    }

    await markEvidence(tx, input.evidenceId, "PROCESSED");
    return {
      status: "PROCESSED" as const,
      productAction,
      variantAction,
    };
  });
}

export async function markShopifyEvidenceIgnored(
  db: ShopifyInboundDb,
  evidenceId: string,
  reason: string,
  message: string
): Promise<void> {
  await markEvidence(db, evidenceId, "IGNORED", { code: reason, message });
}

export async function markShopifyEvidenceError(
  db: ShopifyInboundDb,
  evidenceId: string,
  code: string,
  message: string
): Promise<void> {
  await markEvidence(db, evidenceId, "ERROR", { code, message });
}

export type { ShopifyProviderEvidence, Prisma };
