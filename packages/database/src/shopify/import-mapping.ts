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
import { seedShopifyListingFieldConvergence } from "./field-state";
import {
  ShopifyMappingConflictError,
  ShopifyMappingError,
  type ShopifyListingMappingSnapshot,
  type ShopifyVariantMappingInput,
} from "./mapping";
import { SHOPIFY_MAX_VARIANTS } from "./variant-topology";

export type ShopifyImportMappingDb = PrismaClient | Prisma.TransactionClient;

export type CreateShopifyImportedListingMappingInput = {
  memberId: string;
  connectionId: string;
  storeItemId: string;
  shopifyProductId: string;
  variants: ShopifyVariantMappingInput[];
  remoteProductStatus: string | null;
  importBootstrapStartedAt: Date;
  /**
   * Per-variant opening available quantity at primary location.
   * Parallel array (same order as `variants`), OR a single scalar applied to all.
   * null entries → MTO / not tracked for that variant.
   */
  remoteAvailable: number | null | (number | null)[];
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

function resolvePerVariantAvailable(
  remoteAvailable: number | null | (number | null)[],
  variantCount: number
): (number | null)[] {
  if (Array.isArray(remoteAvailable)) {
    if (remoteAvailable.length !== variantCount) {
      throw new ShopifyMappingError(
        "INVALID_VARIANTS",
        `remoteAvailable array length ${remoteAvailable.length} does not match variant count ${variantCount}`
      );
    }
    return remoteAvailable;
  }
  return Array.from({ length: variantCount }, () => remoteAvailable);
}

/**
 * Create mapping for a Shopify→INW import inside an existing transaction.
 * Seeds S5 BASE=LOCAL=REMOTE fingerprints (first variant only) and S8 INITIALIZED / NOT_APPLICABLE baselines per variant.
 * Supports 1..100 variants. Does NOT enqueue PROJECT_INVENTORY or UPDATE_LISTING_CONTENT.
 */
export async function createShopifyImportedListingMapping(
  tx: ShopifyImportMappingDb,
  input: CreateShopifyImportedListingMappingInput
): Promise<ShopifyListingMappingSnapshot> {
  if (
    !input.variants ||
    input.variants.length < 1 ||
    input.variants.length > SHOPIFY_MAX_VARIANTS
  ) {
    throw new ShopifyMappingError(
      "INVALID_VARIANTS",
      `Shopify import requires 1–${SHOPIFY_MAX_VARIANTS} variant mappings; got ${input.variants?.length ?? 0}`
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

  const perVariantAvailable = resolvePerVariantAvailable(
    input.remoteAvailable,
    input.variants.length
  );

  const validatedVariants: Array<{
    storeVariantId: string;
    shopifyVariantId: string;
    shopifyInventoryItemId: string;
  }> = [];
  const seenStoreVariants = new Set<string>();
  const seenShopifyVariants = new Set<string>();
  const seenInventoryItems = new Set<string>();

  for (const variant of input.variants) {
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
    if (seenStoreVariants.has(variant.storeVariantId)) {
      throw new ShopifyMappingConflictError("Duplicate StoreVariant in import mapping");
    }
    if (seenShopifyVariants.has(shopifyVariantId)) {
      throw new ShopifyMappingConflictError("Duplicate Shopify ProductVariant in import mapping");
    }
    if (seenInventoryItems.has(shopifyInventoryItemId)) {
      throw new ShopifyMappingConflictError("Duplicate Shopify InventoryItem in import mapping");
    }
    seenStoreVariants.add(variant.storeVariantId);
    seenShopifyVariants.add(shopifyVariantId);
    seenInventoryItems.add(shopifyInventoryItemId);
    validatedVariants.push({ storeVariantId: variant.storeVariantId, shopifyVariantId, shopifyInventoryItemId });
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
    select: { id: true, title: true, description: true, photos: true },
  });
  if (!storeItem) {
    throw new ShopifyMappingError("STORE_ITEM_NOT_FOUND", "Store item was not found for this member");
  }

  const storeVariants = await tx.storeVariant.findMany({
    where: {
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      id: { in: validatedVariants.map((v) => v.storeVariantId) },
    },
    select: { id: true, priceCents: true, sku: true },
  });
  if (storeVariants.length !== validatedVariants.length) {
    throw new ShopifyMappingError(
      "STORE_VARIANT_NOT_FOUND",
      "Store variant does not belong to this store item"
    );
  }
  const storeVariantById = new Map(storeVariants.map((sv) => [sv.id, sv]));

  // Idempotent already-mapped path
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

  // Check all variant identity collisions at once
  for (const v of validatedVariants) {
    const conflict = await tx.shopifyVariantMap.findFirst({
      where: {
        shopifyConnectionId: input.connectionId,
        OR: [
          { storeVariantId: v.storeVariantId },
          { shopifyVariantId: v.shopifyVariantId },
          { shopifyInventoryItemId: v.shopifyInventoryItemId },
        ],
      },
      select: { id: true },
    });
    if (conflict) throw new ShopifyMappingConflictError();
  }

  const now = new Date();
  const productFp = shopifyProductContentFingerprint({
    title: storeItem.title,
    description: storeItem.description,
    photos: storeItem.photos,
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

  // Create all variant maps with per-variant inventory baselines
  for (let i = 0; i < validatedVariants.length; i++) {
    const v = validatedVariants[i]!;
    const sv = storeVariantById.get(v.storeVariantId)!;
    const available = perVariantAvailable[i] ?? null;
    const variantFp = shopifyVariantContentFingerprint({
      priceCents: sv.priceCents,
      sku: sv.sku,
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
            inventoryDesiredAvailable: available,
            inventoryAppliedVersion: 1,
            inventoryAppliedAvailable: available,
            inventoryLastObservedAvailable: available,
            inventoryDesiredAt: now,
            inventoryAppliedAt: now,
          };

    await tx.shopifyVariantMap.create({
      data: {
        shopifyConnectionId: input.connectionId,
        shopifyListingLinkId: listingLink.id,
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        storeVariantId: v.storeVariantId,
        shopifyVariantId: v.shopifyVariantId,
        shopifyInventoryItemId: v.shopifyInventoryItemId,
        desiredVariantFingerprint: variantFp,
        appliedVariantFingerprint: variantFp,
        lastObservedVariantFingerprint: variantFp,
        lastObservedVariantUpdatedAt: now,
        variantContentAppliedAt: now,
        inventoryDriftState: "NONE",
        ...inventorySeed,
      },
    });
  }

  // Seed field convergence for every imported variant (product fields upsert idempotently).
  for (const v of validatedVariants) {
    const sv = storeVariantById.get(v.storeVariantId)!;
    await seedShopifyListingFieldConvergence(tx, {
      connectionId: input.connectionId,
      listingLinkId: listingLink.id,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      storeVariantId: sv.id,
      title: storeItem.title,
      description: storeItem.description,
      priceCents: sv.priceCents,
      sku: sv.sku,
    });
  }

  const variantMaps = await tx.shopifyVariantMap.findMany({
    where: { shopifyListingLinkId: listingLink.id },
    select: variantSelect,
  });
  return { listingLink, variantMaps };
}
