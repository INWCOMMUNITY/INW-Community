import type { Prisma, PrismaClient, WixListingLink, WixVariantMap } from "@prisma/client";

export type WixMappingDb = PrismaClient | Prisma.TransactionClient;

export class WixMappingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WixMappingError";
    this.code = code;
  }
}

export class WixMappingConflictError extends WixMappingError {
  constructor(message = "Wix listing mapping conflict") {
    super("MAPPING_CONFLICT", message);
    this.name = "WixMappingConflictError";
  }
}

export type WixVariantMappingInput = {
  storeVariantId: string;
  wixVariantId: string;
  wixInventoryItemId?: string | null;
  choicesJson?: Prisma.InputJsonValue | null;
  remoteSku?: string | null;
};

export type CreateWixImportedListingMappingInput = {
  wixConnectionId: string;
  memberId: string;
  storeItemId: string;
  wixProductId: string;
  variants: WixVariantMappingInput[];
  bootstrapStartedAt: Date;
};

export type WixListingMappingSnapshot = {
  listingLink: WixListingLink;
  variantMaps: WixVariantMap[];
};

/**
 * Create a mapping from an imported Wix product to an INW StoreItem.
 * Used during product import flow.
 */
export async function createWixImportedListingMapping(
  db: WixMappingDb,
  input: CreateWixImportedListingMappingInput
): Promise<WixListingMappingSnapshot> {
  // Check for existing link
  const existingLink = await db.wixListingLink.findFirst({
    where: {
      wixConnectionId: input.wixConnectionId,
      wixProductId: input.wixProductId,
    },
  });
  if (existingLink) {
    throw new WixMappingConflictError(
      `Wix product ${input.wixProductId} is already linked to StoreItem ${existingLink.storeItemId}`
    );
  }

  // Create the listing link
  const listingLink = await db.wixListingLink.create({
    data: {
      wixConnectionId: input.wixConnectionId,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      wixProductId: input.wixProductId,
      importSource: "WIX_IMPORT",
      importedAt: new Date(),
      importBootstrapStartedAt: input.bootstrapStartedAt,
      readiness: "SYNCING",
    },
  });

  // Create variant maps
  const variantMaps: WixVariantMap[] = [];
  for (const variant of input.variants) {
    const variantMap = await db.wixVariantMap.create({
      data: {
        wixConnectionId: input.wixConnectionId,
        wixListingLinkId: listingLink.id,
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        storeVariantId: variant.storeVariantId,
        wixVariantId: variant.wixVariantId,
        wixInventoryItemId: variant.wixInventoryItemId ?? null,
        choicesJson: variant.choicesJson ?? undefined,
        remoteSku: variant.remoteSku ?? null,
      },
    });
    variantMaps.push(variantMap);
  }

  return { listingLink, variantMaps };
}

/**
 * Create a mapping for a natively created (exported) listing.
 */
export type CreateWixNativeListingMappingInput = {
  wixConnectionId: string;
  memberId: string;
  storeItemId: string;
  wixProductId: string;
  variants: WixVariantMappingInput[];
};

export async function createWixNativeListingMapping(
  db: WixMappingDb,
  input: CreateWixNativeListingMappingInput
): Promise<WixListingMappingSnapshot> {
  // Check for existing link
  const existingLink = await db.wixListingLink.findFirst({
    where: {
      wixConnectionId: input.wixConnectionId,
      storeItemId: input.storeItemId,
    },
  });
  if (existingLink) {
    throw new WixMappingConflictError(
      `StoreItem ${input.storeItemId} is already linked to Wix product ${existingLink.wixProductId}`
    );
  }

  // Create the listing link
  const listingLink = await db.wixListingLink.create({
    data: {
      wixConnectionId: input.wixConnectionId,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      wixProductId: input.wixProductId,
      importSource: "NATIVE",
      readiness: "SYNCING",
    },
  });

  // Create variant maps
  const variantMaps: WixVariantMap[] = [];
  for (const variant of input.variants) {
    const variantMap = await db.wixVariantMap.create({
      data: {
        wixConnectionId: input.wixConnectionId,
        wixListingLinkId: listingLink.id,
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        storeVariantId: variant.storeVariantId,
        wixVariantId: variant.wixVariantId,
        wixInventoryItemId: variant.wixInventoryItemId ?? null,
        choicesJson: variant.choicesJson ?? undefined,
        remoteSku: variant.remoteSku ?? null,
      },
    });
    variantMaps.push(variantMap);
  }

  return { listingLink, variantMaps };
}

/**
 * Lookup a Wix listing link by remote product ID.
 */
export async function lookupWixListingByRemoteId(
  db: WixMappingDb,
  wixConnectionId: string,
  wixProductId: string
): Promise<WixListingMappingSnapshot | null> {
  const listingLink = await db.wixListingLink.findFirst({
    where: { wixConnectionId, wixProductId },
    include: { variantMaps: true },
  });
  if (!listingLink) return null;
  return { listingLink, variantMaps: listingLink.variantMaps };
}

/**
 * Lookup a Wix listing link by StoreItem ID.
 */
export async function lookupWixListingByStoreItem(
  db: WixMappingDb,
  wixConnectionId: string,
  storeItemId: string
): Promise<WixListingMappingSnapshot | null> {
  const listingLink = await db.wixListingLink.findFirst({
    where: { wixConnectionId, storeItemId },
    include: { variantMaps: true },
  });
  if (!listingLink) return null;
  return { listingLink, variantMaps: listingLink.variantMaps };
}

/**
 * Lookup a Wix variant map by StoreVariant ID.
 */
export async function lookupWixVariantByStoreVariant(
  db: WixMappingDb,
  wixConnectionId: string,
  storeVariantId: string
): Promise<WixVariantMap | null> {
  return db.wixVariantMap.findFirst({
    where: { wixConnectionId, storeVariantId },
  });
}

/**
 * Lookup a Wix variant map by remote Wix variant ID.
 */
export async function lookupWixVariantByRemoteVariant(
  db: WixMappingDb,
  wixConnectionId: string,
  wixVariantId: string
): Promise<WixVariantMap | null> {
  return db.wixVariantMap.findFirst({
    where: { wixConnectionId, wixVariantId },
  });
}

/**
 * Replace all variant maps for a listing link (used when topology changes).
 */
export async function replaceWixListingVariantMaps(
  db: WixMappingDb,
  input: {
    listingLinkId: string;
    wixConnectionId: string;
    memberId: string;
    storeItemId: string;
    variants: WixVariantMappingInput[];
  }
): Promise<WixVariantMap[]> {
  // Delete existing variant maps
  await db.wixVariantMap.deleteMany({
    where: { wixListingLinkId: input.listingLinkId },
  });

  // Create new variant maps
  const variantMaps: WixVariantMap[] = [];
  for (const variant of input.variants) {
    const variantMap = await db.wixVariantMap.create({
      data: {
        wixConnectionId: input.wixConnectionId,
        wixListingLinkId: input.listingLinkId,
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        storeVariantId: variant.storeVariantId,
        wixVariantId: variant.wixVariantId,
        wixInventoryItemId: variant.wixInventoryItemId ?? null,
        choicesJson: variant.choicesJson ?? undefined,
        remoteSku: variant.remoteSku ?? null,
      },
    });
    variantMaps.push(variantMap);
  }

  return variantMaps;
}

/**
 * Delete a Wix listing link and all its variant maps.
 */
export async function deleteWixListingMapping(
  db: WixMappingDb,
  listingLinkId: string
): Promise<void> {
  // Delete variant maps first (foreign key constraint)
  await db.wixVariantMap.deleteMany({
    where: { wixListingLinkId: listingLinkId },
  });
  // Delete the listing link
  await db.wixListingLink.delete({
    where: { id: listingLinkId },
  });
}
