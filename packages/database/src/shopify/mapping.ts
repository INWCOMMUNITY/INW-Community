import type { Prisma, PrismaClient, ShopifyListingLink, ShopifyVariantMap } from "@prisma/client";
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
import { seedShopifyInventoryProjectionOnMapping } from "./inventory-desire";

export type ShopifyMappingDb = PrismaClient | Prisma.TransactionClient;

export type ShopifyVariantMappingInput = {
  storeVariantId: string;
  shopifyVariantId: string;
  shopifyInventoryItemId: string;
};

export type CreateShopifyListingMappingInput = {
  memberId: string;
  connectionId: string;
  storeItemId: string;
  shopifyProductId: string;
  variants: ShopifyVariantMappingInput[];
};

export type ShopifyListingMappingSnapshot = {
  listingLink: Pick<
    ShopifyListingLink,
    | "id"
    | "shopifyConnectionId"
    | "memberId"
    | "storeItemId"
    | "shopifyProductId"
    | "createdAt"
    | "updatedAt"
  >;
  variantMaps: Array<
    Pick<
      ShopifyVariantMap,
      | "id"
      | "shopifyConnectionId"
      | "shopifyListingLinkId"
      | "memberId"
      | "storeItemId"
      | "storeVariantId"
      | "shopifyVariantId"
      | "shopifyInventoryItemId"
      | "createdAt"
      | "updatedAt"
    >
  >;
};

export type ShopifyMappedListing = {
  status: "MAPPED";
  listingLink: ShopifyListingMappingSnapshot["listingLink"];
  variantMaps: ShopifyListingMappingSnapshot["variantMaps"];
};

export type ShopifyMappedVariant = {
  status: "MAPPED";
  variantMap: ShopifyListingMappingSnapshot["variantMaps"][number];
  listingLink: ShopifyListingMappingSnapshot["listingLink"];
};

export type ShopifyMappingLookupResult =
  | ShopifyMappedListing
  | ShopifyMappedVariant
  | { status: "UNMAPPED" }
  | { status: "CONNECTION_INACTIVE" };

export type ShopifyMappingCode =
  | "MAPPING_CONFLICT"
  | "CONNECTION_INACTIVE"
  | "CONNECTION_NOT_FOUND"
  | "STORE_ITEM_NOT_FOUND"
  | "STORE_VARIANT_NOT_FOUND"
  | "INVALID_VARIANTS"
  | "INVALID_SHOPIFY_GID";

export class ShopifyMappingError extends Error {
  readonly code: ShopifyMappingCode;

  constructor(code: ShopifyMappingCode, message: string) {
    super(message);
    this.name = "ShopifyMappingError";
    this.code = code;
  }
}

export class ShopifyMappingConflictError extends ShopifyMappingError {
  constructor(message = "Shopify mapping conflict") {
    super("MAPPING_CONFLICT", message);
    this.name = "ShopifyMappingConflictError";
  }
}

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

function mappingLockKey(connectionId: string): string {
  return `shopify-mapping:${connectionId}`;
}

function normalizeVariantInputs(variants: ShopifyVariantMappingInput[]): ShopifyVariantMappingInput[] {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new ShopifyMappingError("INVALID_VARIANTS", "At least one variant mapping is required");
  }
  const seenStore = new Set<string>();
  const seenRemoteVariant = new Set<string>();
  const seenInventory = new Set<string>();
  const normalized: ShopifyVariantMappingInput[] = [];
  for (const row of variants) {
    const storeVariantId = typeof row.storeVariantId === "string" ? row.storeVariantId.trim() : "";
    if (!storeVariantId) {
      throw new ShopifyMappingError("INVALID_VARIANTS", "Store variant id is required");
    }
    let shopifyVariantId: string;
    let shopifyInventoryItemId: string;
    try {
      shopifyVariantId = assertShopifyProductVariantGid(
        typeof row.shopifyVariantId === "string" ? row.shopifyVariantId.trim() : ""
      );
      shopifyInventoryItemId = assertShopifyInventoryItemGid(
        typeof row.shopifyInventoryItemId === "string" ? row.shopifyInventoryItemId.trim() : ""
      );
    } catch (error) {
      if (error instanceof ShopifyGidValidationError) {
        throw new ShopifyMappingError("INVALID_SHOPIFY_GID", error.message);
      }
      throw error;
    }
    if (seenStore.has(storeVariantId)) {
      throw new ShopifyMappingConflictError("Duplicate StoreVariant in mapping request");
    }
    if (seenRemoteVariant.has(shopifyVariantId)) {
      throw new ShopifyMappingConflictError("Duplicate Shopify ProductVariant in mapping request");
    }
    if (seenInventory.has(shopifyInventoryItemId)) {
      throw new ShopifyMappingConflictError("Duplicate Shopify InventoryItem in mapping request");
    }
    seenStore.add(storeVariantId);
    seenRemoteVariant.add(shopifyVariantId);
    seenInventory.add(shopifyInventoryItemId);
    normalized.push({ storeVariantId, shopifyVariantId, shopifyInventoryItemId });
  }
  return normalized.sort((a, b) => a.storeVariantId.localeCompare(b.storeVariantId));
}

function variantMapsMatch(
  existing: Array<{
    storeVariantId: string;
    shopifyVariantId: string;
    shopifyInventoryItemId: string;
  }>,
  requested: ShopifyVariantMappingInput[]
): boolean {
  if (existing.length !== requested.length) return false;
  const byStore = new Map(existing.map((row) => [row.storeVariantId, row]));
  for (const row of requested) {
    const match = byStore.get(row.storeVariantId);
    if (!match) return false;
    if (
      match.shopifyVariantId !== row.shopifyVariantId ||
      match.shopifyInventoryItemId !== row.shopifyInventoryItemId
    ) {
      return false;
    }
  }
  return true;
}

async function loadListingSnapshot(
  db: ShopifyMappingDb,
  listingLinkId: string
): Promise<ShopifyListingMappingSnapshot> {
  const listingLink = await db.shopifyListingLink.findUniqueOrThrow({
    where: { id: listingLinkId },
    select: listingSelect,
  });
  const variantMaps = await db.shopifyVariantMap.findMany({
    where: { shopifyListingLinkId: listingLinkId },
    orderBy: { storeVariantId: "asc" },
    select: variantSelect,
  });
  return { listingLink, variantMaps };
}

/**
 * Persist a generation-bound listing + variant mapping.
 * No Shopify network calls. Exact duplicate retry is idempotent; any conflict fails closed.
 */
export async function createShopifyListingMapping(
  db: PrismaClient,
  input: CreateShopifyListingMappingInput
): Promise<ShopifyListingMappingSnapshot> {
  let shopifyProductId: string;
  try {
    shopifyProductId = assertShopifyProductGid(input.shopifyProductId.trim());
  } catch (error) {
    if (error instanceof ShopifyGidValidationError) {
      throw new ShopifyMappingError("INVALID_SHOPIFY_GID", error.message);
    }
    throw error;
  }
  const variants = normalizeVariantInputs(input.variants);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${mappingLockKey(input.connectionId)}))`;

    const connection = await tx.shopifyConnection.findFirst({
      where: { id: input.connectionId, memberId: input.memberId },
      select: { id: true, memberId: true, status: true },
    });
    if (!connection) {
      throw new ShopifyMappingError("CONNECTION_NOT_FOUND", "Shopify connection was not found");
    }
    if (connection.status !== "ACTIVE") {
      throw new ShopifyMappingError("CONNECTION_INACTIVE", "Shopify connection is not active");
    }

    const storeItem = await tx.storeItem.findFirst({
      where: { id: input.storeItemId, memberId: input.memberId },
      select: { id: true, memberId: true, title: true, description: true },
    });
    if (!storeItem) {
      throw new ShopifyMappingError("STORE_ITEM_NOT_FOUND", "Store item was not found for this member");
    }

    const storeVariants = await tx.storeVariant.findMany({
      where: {
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        id: { in: variants.map((row) => row.storeVariantId) },
      },
      select: { id: true, priceCents: true, sku: true },
    });
    if (storeVariants.length !== variants.length) {
      throw new ShopifyMappingError(
        "STORE_VARIANT_NOT_FOUND",
        "Store variant does not belong to this store item"
      );
    }
    const storeVariantById = new Map(storeVariants.map((row) => [row.id, row]));

    const existingByItem = await tx.shopifyListingLink.findFirst({
      where: { shopifyConnectionId: input.connectionId, storeItemId: input.storeItemId },
      select: { id: true, shopifyProductId: true },
    });
    if (existingByItem) {
      const snapshot = await loadListingSnapshot(tx, existingByItem.id);
      if (
        existingByItem.shopifyProductId === shopifyProductId &&
        variantMapsMatch(snapshot.variantMaps, variants)
      ) {
        return snapshot;
      }
      throw new ShopifyMappingConflictError();
    }

    const existingByProduct = await tx.shopifyListingLink.findFirst({
      where: { shopifyConnectionId: input.connectionId, shopifyProductId },
      select: { id: true },
    });
    if (existingByProduct) {
      throw new ShopifyMappingConflictError();
    }

    for (const row of variants) {
      const conflict = await tx.shopifyVariantMap.findFirst({
        where: {
          shopifyConnectionId: input.connectionId,
          OR: [
            { storeVariantId: row.storeVariantId },
            { shopifyVariantId: row.shopifyVariantId },
            { shopifyInventoryItemId: row.shopifyInventoryItemId },
          ],
        },
        select: { id: true },
      });
      if (conflict) throw new ShopifyMappingConflictError();
    }

    try {
      // S4 just verified Shopify contains this content — seed applied as first BASE.
      const productFp = shopifyProductContentFingerprint({
        title: storeItem.title,
        description: storeItem.description,
      });
      const now = new Date();
      const listingLink = await tx.shopifyListingLink.create({
        data: {
          shopifyConnectionId: input.connectionId,
          memberId: input.memberId,
          storeItemId: input.storeItemId,
          shopifyProductId,
          desiredProductFingerprint: productFp,
          appliedProductFingerprint: productFp,
          productContentAppliedAt: now,
        },
        select: listingSelect,
      });
      await tx.shopifyVariantMap.createMany({
        data: variants.map((row) => {
          const sv = storeVariantById.get(row.storeVariantId)!;
          const variantFp = shopifyVariantContentFingerprint({
            priceCents: sv.priceCents,
            sku: sv.sku,
          });
          return {
            shopifyConnectionId: input.connectionId,
            shopifyListingLinkId: listingLink.id,
            memberId: input.memberId,
            storeItemId: input.storeItemId,
            storeVariantId: row.storeVariantId,
            shopifyVariantId: row.shopifyVariantId,
            shopifyInventoryItemId: row.shopifyInventoryItemId,
            desiredVariantFingerprint: variantFp,
            appliedVariantFingerprint: variantFp,
            variantContentAppliedAt: now,
          };
        }),
      });
      // S8: seed initial inventory desire + PROJECT_INVENTORY job atomically with mapping.
      const createdMaps = await tx.shopifyVariantMap.findMany({
        where: { shopifyListingLinkId: listingLink.id },
        select: { id: true, storeVariantId: true },
      });
      for (const map of createdMaps) {
        await seedShopifyInventoryProjectionOnMapping(tx, {
          connectionId: input.connectionId,
          memberId: input.memberId,
          storeItemId: input.storeItemId,
          storeVariantId: map.storeVariantId,
          variantMapId: map.id,
        });
      }
      return loadListingSnapshot(tx, listingLink.id);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        throw new ShopifyMappingConflictError();
      }
      throw error;
    }
  });
}

async function requireActiveConnectionForLookup(
  db: ShopifyMappingDb,
  connectionId: string
): Promise<"ok" | "CONNECTION_INACTIVE" | "CONNECTION_NOT_FOUND"> {
  const connection = await db.shopifyConnection.findUnique({
    where: { id: connectionId },
    select: { status: true },
  });
  if (!connection) return "CONNECTION_NOT_FOUND";
  if (connection.status !== "ACTIVE") return "CONNECTION_INACTIVE";
  return "ok";
}

function inactiveOrMissing(
  gate: "ok" | "CONNECTION_INACTIVE" | "CONNECTION_NOT_FOUND"
): ShopifyMappingLookupResult | null {
  if (gate === "CONNECTION_INACTIVE") return { status: "CONNECTION_INACTIVE" };
  if (gate === "CONNECTION_NOT_FOUND") return { status: "UNMAPPED" };
  return null;
}

export async function lookupShopifyListingByStoreItem(
  db: ShopifyMappingDb,
  input: { connectionId: string; storeItemId: string }
): Promise<ShopifyMappedListing | { status: "UNMAPPED" } | { status: "CONNECTION_INACTIVE" }> {
  const gate = await requireActiveConnectionForLookup(db, input.connectionId);
  const early = inactiveOrMissing(gate);
  if (early) return early as { status: "UNMAPPED" } | { status: "CONNECTION_INACTIVE" };

  const listing = await db.shopifyListingLink.findUnique({
    where: {
      shopifyConnectionId_storeItemId: {
        shopifyConnectionId: input.connectionId,
        storeItemId: input.storeItemId,
      },
    },
    select: listingSelect,
  });
  if (!listing) return { status: "UNMAPPED" };
  const variantMaps = await db.shopifyVariantMap.findMany({
    where: { shopifyListingLinkId: listing.id },
    orderBy: { storeVariantId: "asc" },
    select: variantSelect,
  });
  return { status: "MAPPED", listingLink: listing, variantMaps };
}

export async function lookupShopifyListingByProductId(
  db: ShopifyMappingDb,
  input: { connectionId: string; shopifyProductId: string }
): Promise<ShopifyMappedListing | { status: "UNMAPPED" } | { status: "CONNECTION_INACTIVE" }> {
  const gate = await requireActiveConnectionForLookup(db, input.connectionId);
  const early = inactiveOrMissing(gate);
  if (early) return early as { status: "UNMAPPED" } | { status: "CONNECTION_INACTIVE" };

  const listing = await db.shopifyListingLink.findUnique({
    where: {
      shopifyConnectionId_shopifyProductId: {
        shopifyConnectionId: input.connectionId,
        shopifyProductId: input.shopifyProductId,
      },
    },
    select: listingSelect,
  });
  if (!listing) return { status: "UNMAPPED" };
  const variantMaps = await db.shopifyVariantMap.findMany({
    where: { shopifyListingLinkId: listing.id },
    orderBy: { storeVariantId: "asc" },
    select: variantSelect,
  });
  return { status: "MAPPED", listingLink: listing, variantMaps };
}

async function lookupVariantMap(
  db: ShopifyMappingDb,
  where: Prisma.ShopifyVariantMapWhereInput
): Promise<ShopifyMappedVariant | { status: "UNMAPPED" } | { status: "CONNECTION_INACTIVE" }> {
  const connectionId =
    typeof where.shopifyConnectionId === "string" ? where.shopifyConnectionId : null;
  if (!connectionId) return { status: "UNMAPPED" };
  const gate = await requireActiveConnectionForLookup(db, connectionId);
  const early = inactiveOrMissing(gate);
  if (early) return early as { status: "UNMAPPED" } | { status: "CONNECTION_INACTIVE" };

  const variantMap = await db.shopifyVariantMap.findFirst({
    where,
    select: variantSelect,
  });
  if (!variantMap) return { status: "UNMAPPED" };
  const listingLink = await db.shopifyListingLink.findUniqueOrThrow({
    where: { id: variantMap.shopifyListingLinkId },
    select: listingSelect,
  });
  return { status: "MAPPED", variantMap, listingLink };
}

export async function lookupShopifyVariantByStoreVariant(
  db: ShopifyMappingDb,
  input: { connectionId: string; storeVariantId: string }
) {
  return lookupVariantMap(db, {
    shopifyConnectionId: input.connectionId,
    storeVariantId: input.storeVariantId,
  });
}

export async function lookupShopifyVariantByRemoteVariant(
  db: ShopifyMappingDb,
  input: { connectionId: string; shopifyVariantId: string }
) {
  return lookupVariantMap(db, {
    shopifyConnectionId: input.connectionId,
    shopifyVariantId: input.shopifyVariantId,
  });
}

export async function lookupShopifyVariantByInventoryItem(
  db: ShopifyMappingDb,
  input: { connectionId: string; shopifyInventoryItemId: string }
) {
  return lookupVariantMap(db, {
    shopifyConnectionId: input.connectionId,
    shopifyInventoryItemId: input.shopifyInventoryItemId,
  });
}
