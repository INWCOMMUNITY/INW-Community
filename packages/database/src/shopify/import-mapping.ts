import type { PrismaClient, Prisma } from "@prisma/client";
import {
  shopifyProductContentFingerprint,
  shopifyVariantContentFingerprint,
} from "./content-fingerprint";
import {
  assertShopifyInventoryItemGid,
  assertShopifyProductGid,
  assertShopifyProductVariantGid,
  ShopifyGidValidationError,
} from "./gids";
import {
  ShopifyMappingConflictError,
  ShopifyMappingError,
  type ShopifyListingMappingSnapshot,
  type ShopifyVariantMappingInput,
} from "./mapping";

export type ShopifyImportMappingDb = PrismaClient | Prisma.TransactionClient;

export type CreateShopifyImportedListingMappingInput = {
  memberId: string;
  connectionId: string;
  storeItemId: string;
  shopifyProductId: string;
  variants: ShopifyVariantMappingInput[];
  remoteProductStatus: string | null;
  importBootstrapStartedAt: Date;
  /** PHYSICAL sellable at primary location; null for MTO. */
  remoteAvailable: number | null;
  inventoryMode: "TRACKED_FINITE" | "MADE_TO_ORDER";
};

const listingSelect = {
  id: true,
  shopifyConnectionId: true,
  memberId: true,
  storeItemId: true,
  shopifyProductId: true,
  createdAt: true,
  updatedAt: true,
} as const;

const variantSelect = {
  id: true,
  shopifyConnectionId: true,
  shopifyListingLinkId: true,
  memberId: true,
  storeItemId: true,
  storeVariantId: true,
  shopifyVariantId: true,
  shopifyInventoryItemId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Create mapping for a Shopify→INW import inside an existing transaction.
 * Seeds S5 BASE=LOCAL=REMOTE fingerprints and S8 INITIALIZED / NOT_APPLICABLE baselines.
 * Does NOT enqueue PROJECT_INVENTORY or UPDATE_LISTING_CONTENT.
 */
export async function createShopifyImportedListingMapping(
  tx: ShopifyImportMappingDb,
  input: CreateShopifyImportedListingMappingInput
): Promise<ShopifyListingMappingSnapshot> {
  if (!input.variants || input.variants.length !== 1) {
    throw new ShopifyMappingError(
      "INVALID_VARIANTS",
      "Shopify import currently supports exactly one variant mapping"
    );
  }

  let shopifyProductId: string;
  try {
    shopifyProductId = assertShopifyProductGid(input.shopifyProductId.trim());
  } catch (error) {
    if (error instanceof ShopifyGidValidationError) {
      throw new ShopifyMappingError("INVALID_SHOPIFY_GID", error.message);
    }
    throw error;
  }

  const variant = input.variants[0]!;
  let shopifyVariantId: string;
  let shopifyInventoryItemId: string;
  try {
    shopifyVariantId = assertShopifyProductVariantGid(variant.shopifyVariantId.trim());
    shopifyInventoryItemId = assertShopifyInventoryItemGid(variant.shopifyInventoryItemId.trim());
  } catch (error) {
    if (error instanceof ShopifyGidValidationError) {
      throw new ShopifyMappingError("INVALID_SHOPIFY_GID", error.message);
    }
    throw error;
  }

  const connection = await tx.shopifyConnection.findFirst({
    where: { id: input.connectionId, memberId: input.memberId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!connection) {
    throw new ShopifyMappingError("CONNECTION_INACTIVE", "No active Shopify connection");
  }

  const storeItem = await tx.storeItem.findFirst({
    where: { id: input.storeItemId, memberId: input.memberId },
    select: { id: true, title: true, description: true },
  });
  if (!storeItem) {
    throw new ShopifyMappingError("STORE_ITEM_NOT_FOUND", "Store item was not found for this member");
  }

  const storeVariant = await tx.storeVariant.findFirst({
    where: {
      id: variant.storeVariantId,
      storeItemId: input.storeItemId,
      memberId: input.memberId,
    },
    select: { id: true, priceCents: true, sku: true },
  });
  if (!storeVariant) {
    throw new ShopifyMappingError(
      "STORE_VARIANT_NOT_FOUND",
      "Store variant does not belong to this store item"
    );
  }

  const existingByProduct = await tx.shopifyListingLink.findFirst({
    where: { shopifyConnectionId: input.connectionId, shopifyProductId },
    select: { id: true, storeItemId: true },
  });
  if (existingByProduct) {
    if (existingByProduct.storeItemId === input.storeItemId) {
      const maps = await tx.shopifyVariantMap.findMany({
        where: { shopifyListingLinkId: existingByProduct.id },
        select: variantSelect,
      });
      const link = await tx.shopifyListingLink.findUniqueOrThrow({
        where: { id: existingByProduct.id },
        select: listingSelect,
      });
      return { listingLink: link, variantMaps: maps };
    }
    throw new ShopifyMappingConflictError("Shopify product is already mapped on this connection");
  }

  const existingByItem = await tx.shopifyListingLink.findFirst({
    where: { shopifyConnectionId: input.connectionId, storeItemId: input.storeItemId },
    select: { id: true },
  });
  if (existingByItem) {
    throw new ShopifyMappingConflictError("Store item is already mapped on this connection");
  }

  const conflict = await tx.shopifyVariantMap.findFirst({
    where: {
      shopifyConnectionId: input.connectionId,
      OR: [{ storeVariantId: storeVariant.id }, { shopifyVariantId }, { shopifyInventoryItemId }],
    },
    select: { id: true },
  });
  if (conflict) throw new ShopifyMappingConflictError();

  const now = new Date();
  const productFp = shopifyProductContentFingerprint({
    title: storeItem.title,
    description: storeItem.description,
  });
  const variantFp = shopifyVariantContentFingerprint({
    priceCents: storeVariant.priceCents,
    sku: storeVariant.sku,
  });

  const listingLink = await tx.shopifyListingLink.create({
    data: {
      shopifyConnectionId: input.connectionId,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      shopifyProductId,
      desiredProductFingerprint: productFp,
      appliedProductFingerprint: productFp,
      lastObservedProductFingerprint: productFp,
      lastObservedProductUpdatedAt: now,
      productContentAppliedAt: now,
      remoteProductStatus: input.remoteProductStatus,
      importSource: "SHOPIFY_IMPORT",
      importedAt: now,
      importBootstrapStartedAt: input.importBootstrapStartedAt,
      readiness: "READY_TO_PUBLISH",
      contentHealth: "HEALTHY",
      inventoryHealth: "HEALTHY",
      readinessUpdatedAt: now,
      lastReconciledAt: now,
    },
    select: listingSelect,
  });

  const inventorySeed =
    input.inventoryMode === "MADE_TO_ORDER"
      ? {
          inventoryInitState: "NOT_APPLICABLE" as const,
          inventoryDesiredVersion: 0,
          inventoryDesiredAvailable: null as number | null,
          inventoryAppliedVersion: 0,
          inventoryAppliedAvailable: null as number | null,
          inventoryLastObservedAvailable: null as number | null,
          inventoryDesiredAt: now,
          inventoryAppliedAt: now,
        }
      : {
          inventoryInitState: "INITIALIZED" as const,
          inventoryDesiredVersion: 1,
          inventoryDesiredAvailable: input.remoteAvailable,
          inventoryAppliedVersion: 1,
          inventoryAppliedAvailable: input.remoteAvailable,
          inventoryLastObservedAvailable: input.remoteAvailable,
          inventoryDesiredAt: now,
          inventoryAppliedAt: now,
        };

  await tx.shopifyVariantMap.create({
    data: {
      shopifyConnectionId: input.connectionId,
      shopifyListingLinkId: listingLink.id,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      storeVariantId: storeVariant.id,
      shopifyVariantId,
      shopifyInventoryItemId,
      desiredVariantFingerprint: variantFp,
      appliedVariantFingerprint: variantFp,
      lastObservedVariantFingerprint: variantFp,
      lastObservedVariantUpdatedAt: now,
      variantContentAppliedAt: now,
      inventoryDriftState: "NONE",
      ...inventorySeed,
    },
  });

  const variantMaps = await tx.shopifyVariantMap.findMany({
    where: { shopifyListingLinkId: listingLink.id },
    select: variantSelect,
  });
  return { listingLink, variantMaps };
}
