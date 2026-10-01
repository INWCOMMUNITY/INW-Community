import type { Prisma, PrismaClient } from "@prisma/client";

export type EtsyMappingDb = PrismaClient | Prisma.TransactionClient;

export class EtsyMappingError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "EtsyMappingError";
  }
}

export class EtsyMappingConflictError extends Error {
  constructor(message = "Etsy mapping conflict") {
    super(message);
    this.name = "EtsyMappingConflictError";
  }
}

export type EtsyVariantMappingInput = {
  storeVariantId: string;
  etsyProductId: string;
  etsyOfferingId: string;
  propertyValuesJson?: Prisma.InputJsonValue | null;
  remoteSku?: string | null;
  remoteAvailable?: number | null;
};

export type CreateEtsyImportedListingMappingInput = {
  memberId: string;
  connectionId: string;
  storeItemId: string;
  etsyListingId: string;
  remoteListingState: string | null;
  importBootstrapStartedAt: Date;
  /** Defaults to ETSY_IMPORT for inbound import; NATIVE for INW→Etsy create. */
  importSource?: "NATIVE" | "ETSY_IMPORT";
  variants: EtsyVariantMappingInput[];
};

export type EtsyListingMappingSnapshot = {
  listingLinkId: string;
  storeItemId: string;
  etsyListingId: string;
  variantMapIds: string[];
};

/**
 * Create mapping for an Etsy→INW import inside an existing transaction.
 * Does NOT enqueue outbound content/inventory jobs.
 */
export async function createEtsyImportedListingMapping(
  tx: EtsyMappingDb,
  input: CreateEtsyImportedListingMappingInput
): Promise<EtsyListingMappingSnapshot> {
  if (!input.variants?.length) {
    throw new EtsyMappingError("INVALID_VARIANTS", "Etsy import requires at least one variant mapping");
  }
  if (input.variants.length > 400) {
    throw new EtsyMappingError("INVALID_VARIANTS", "Etsy import exceeds 400 variant mappings");
  }

  const listingId = input.etsyListingId.trim();
  if (!/^\d+$/.test(listingId)) {
    throw new EtsyMappingError("INVALID_LISTING_ID", "Invalid Etsy listing id");
  }

  const seenStore = new Set<string>();
  const seenProduct = new Set<string>();
  const seenOffering = new Set<string>();
  for (const variant of input.variants) {
    const storeVariantId = variant.storeVariantId.trim();
    const etsyProductId = String(variant.etsyProductId).trim();
    const etsyOfferingId = String(variant.etsyOfferingId).trim();
    if (!storeVariantId || !/^\d+$/.test(etsyProductId) || !/^\d+$/.test(etsyOfferingId)) {
      throw new EtsyMappingError("INVALID_VARIANTS", "Variant mapping ids are invalid");
    }
    if (seenStore.has(storeVariantId) || seenProduct.has(etsyProductId) || seenOffering.has(etsyOfferingId)) {
      throw new EtsyMappingError("INVALID_VARIANTS", "Duplicate variant mapping identities");
    }
    seenStore.add(storeVariantId);
    seenProduct.add(etsyProductId);
    seenOffering.add(etsyOfferingId);
  }

  const existing = await tx.etsyListingLink.findFirst({
    where: {
      etsyConnectionId: input.connectionId,
      OR: [{ storeItemId: input.storeItemId }, { etsyListingId: listingId }],
    },
    select: { id: true },
  });
  if (existing) throw new EtsyMappingConflictError();

  const now = input.importBootstrapStartedAt;
  const remote = String(input.remoteListingState ?? "")
    .trim()
    .toLowerCase();
  const isLive = remote === "active";
  const link = await tx.etsyListingLink.create({
    data: {
      etsyConnectionId: input.connectionId,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      etsyListingId: listingId,
      remoteListingState: input.remoteListingState,
      // Drafts (INW→Etsy create) stay SYNCING until activate succeeds — never pretends Live.
      readiness: isLive ? "READY_TO_PUBLISH" : "SYNCING",
      contentHealth: isLive ? "HEALTHY" : "DEGRADED",
      inventoryHealth: "HEALTHY",
      importSource: input.importSource ?? "ETSY_IMPORT",
      importedAt: now,
      importBootstrapStartedAt: now,
      ...(isLive
        ? {}
        : {
            issueCode: "DRAFT_NOT_ACTIVE",
            issueMessage: "Created as an Etsy draft; publishing to live…",
          }),
    },
  });

  const variantMapIds: string[] = [];
  for (const variant of input.variants) {
    const map = await tx.etsyVariantMap.create({
      data: {
        etsyConnectionId: input.connectionId,
        etsyListingLinkId: link.id,
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        storeVariantId: variant.storeVariantId.trim(),
        etsyProductId: String(variant.etsyProductId).trim(),
        etsyOfferingId: String(variant.etsyOfferingId).trim(),
        propertyValuesJson: variant.propertyValuesJson ?? undefined,
        remoteSku: variant.remoteSku?.trim() || null,
        inventoryDesiredAvailable: variant.remoteAvailable ?? null,
        inventoryAppliedAvailable: variant.remoteAvailable ?? null,
      },
    });
    variantMapIds.push(map.id);
  }

  return {
    listingLinkId: link.id,
    storeItemId: input.storeItemId,
    etsyListingId: listingId,
    variantMapIds,
  };
}

/**
 * Replace all variant maps on an existing listing link (NATIVE multi-variant repair).
 */
export async function replaceEtsyListingVariantMaps(
  tx: EtsyMappingDb,
  input: {
    listingLinkId: string;
    connectionId: string;
    memberId: string;
    storeItemId: string;
    variants: EtsyVariantMappingInput[];
  }
): Promise<{ variantMapIds: string[] }> {
  if (!input.variants?.length) {
    throw new EtsyMappingError("INVALID_VARIANTS", "Etsy remap requires at least one variant mapping");
  }
  await tx.etsyVariantMap.deleteMany({ where: { etsyListingLinkId: input.listingLinkId } });
  const variantMapIds: string[] = [];
  for (const variant of input.variants) {
    const map = await tx.etsyVariantMap.create({
      data: {
        etsyConnectionId: input.connectionId,
        etsyListingLinkId: input.listingLinkId,
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        storeVariantId: variant.storeVariantId.trim(),
        etsyProductId: String(variant.etsyProductId).trim(),
        etsyOfferingId: String(variant.etsyOfferingId).trim(),
        propertyValuesJson: variant.propertyValuesJson ?? undefined,
        remoteSku: variant.remoteSku?.trim() || null,
        inventoryDesiredAvailable: variant.remoteAvailable ?? null,
        inventoryAppliedAvailable: variant.remoteAvailable ?? null,
      },
    });
    variantMapIds.push(map.id);
  }
  return { variantMapIds };
}

export async function lookupEtsyListingByRemoteId(
  db: EtsyMappingDb,
  input: { connectionId: string; etsyListingId: string }
) {
  return db.etsyListingLink.findFirst({
    where: {
      etsyConnectionId: input.connectionId,
      etsyListingId: input.etsyListingId,
    },
  });
}
