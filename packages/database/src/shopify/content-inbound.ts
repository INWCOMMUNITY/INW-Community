import type { Prisma, PrismaClient, ShopifyProviderEvidence } from "@prisma/client";
import { applyShopifyFieldLevelContentInbound } from "./content-inbound-fields";
import { shopifyCentsFromMoneyString } from "./content-fingerprint";
import { applyShopifyMediaInbound, type ShopifyRemoteMediaNode } from "./media-inbound";

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
  media?: ShopifyRemoteMediaNode[];
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
 * Apply a re-read Shopify product observation using field-level three-way classification.
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
    /**
     * When provided, apply independent PRICE/SKU semantics for every mapped variant
     * present on the remote product (multi-variant field isolation).
     * Product TITLE/DESCRIPTION/MEDIA still apply once.
     */
    allMappedVariants?: Array<{ shopifyVariantId: string; storeVariantId: string }>;
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

  const remoteStatus = String(input.remote.status).toUpperCase();
  if (remoteStatus !== "ACTIVE" && remoteStatus !== "DRAFT") {
    await markEvidence(db, input.evidenceId, "ERROR", {
      code: "PRODUCT_BAD_STATUS",
      message: `Mapped Shopify product status is ${remoteStatus}; refusing inbound content import`,
    });
    return {
      status: "ERROR",
      code: "PRODUCT_BAD_STATUS",
      message: `Mapped Shopify product status is ${remoteStatus}`,
    };
  }

  if (input.remote.variants.length < 1) {
    await markEvidence(db, input.evidenceId, "ERROR", {
      code: "VARIANT_CARDINALITY",
      message: "Remote product has no variants",
    });
    return {
      status: "ERROR",
      code: "VARIANT_CARDINALITY",
      message: "Remote product has no variants",
    };
  }
  const remoteVariant =
    input.remote.variants.find((row) => row.id === input.mappedVariantId) ?? null;
  if (!remoteVariant) {
    await markEvidence(db, input.evidenceId, "ERROR", {
      code: "VARIANT_GID_MISMATCH",
      message: "Mapped Shopify variant GID missing from remote product",
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

    const { productAction, variantAction } = await applyShopifyFieldLevelContentInbound(tx, {
      evidenceId: input.evidenceId,
      connectionId: input.connectionId,
      listing,
      variantMap,
      storeItem,
      storeVariant,
      remote: {
        title: input.remote.title,
        descriptionHtml: input.remote.descriptionHtml,
        updatedAt: input.remote.updatedAt,
        priceCents: remotePriceCents,
        sku: remoteVariant.sku,
        variantUpdatedAt: remoteVariant.updatedAt,
      },
    });

    // Additional mapped variants: independent PRICE/SKU only (product fields already applied).
    const extraMaps = (input.allMappedVariants ?? []).filter(
      (row) => row.storeVariantId !== input.mappedStoreVariantId
    );
    const variantActions = [variantAction];
    for (const extra of extraMaps) {
      const remoteExtra = input.remote.variants.find((row) => row.id === extra.shopifyVariantId);
      if (!remoteExtra?.inventoryItemId) continue;
      const extraPrice = shopifyCentsFromMoneyString(remoteExtra.price);
      if (!Number.isFinite(extraPrice)) continue;
      const extraMap = await tx.shopifyVariantMap.findFirst({
        where: {
          shopifyListingLinkId: input.listingLinkId,
          shopifyConnectionId: input.connectionId,
          storeVariantId: extra.storeVariantId,
        },
      });
      const extraStoreVariant = await tx.storeVariant.findFirst({
        where: {
          id: extra.storeVariantId,
          storeItemId: listing.storeItemId,
          memberId: listing.memberId,
        },
      });
      if (!extraMap || !extraStoreVariant) continue;
      const listingNow = await tx.shopifyListingLink.findUniqueOrThrow({
        where: { id: listing.id },
      });
      const itemNow = await tx.storeItem.findFirstOrThrow({
        where: { id: listing.storeItemId, memberId: listing.memberId },
      });
      const extraResult = await applyShopifyFieldLevelContentInbound(tx, {
        evidenceId: input.evidenceId,
        connectionId: input.connectionId,
        listing: listingNow,
        variantMap: extraMap,
        storeItem: itemNow,
        storeVariant: extraStoreVariant,
        remote: {
          title: input.remote.title,
          descriptionHtml: input.remote.descriptionHtml,
          updatedAt: input.remote.updatedAt,
          priceCents: extraPrice,
          sku: remoteExtra.sku,
          variantUpdatedAt: remoteExtra.updatedAt,
        },
      });
      variantActions.push(`${extra.storeVariantId}:${extraResult.variantAction}`);
    }

    let mediaAction = "MEDIA_SKIPPED";
    if (input.remote.media) {
      const mediaResult = await applyShopifyMediaInbound(tx, {
        evidenceId: input.evidenceId,
        connectionId: input.connectionId,
        listingLinkId: listing.id,
        memberId: listing.memberId,
        storeItemId: listing.storeItemId,
        remoteMedia: input.remote.media,
      });
      mediaAction = mediaResult.action;
    }

    await markEvidence(tx, input.evidenceId, "PROCESSED");
    return {
      status: "PROCESSED" as const,
      productAction:
        mediaAction === "MEDIA_SKIPPED" ? productAction : `${productAction}+${mediaAction}`,
      variantAction: variantActions.join("|"),
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
