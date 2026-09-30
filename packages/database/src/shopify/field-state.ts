import type { Prisma, PrismaClient, ShopifyContentFieldKey } from "@prisma/client";
import {
  shopifyDescriptionFieldFingerprint,
  shopifyFieldFingerprint,
} from "./field-fingerprint";
import type { ShopifyFieldPlan } from "./field-semantic";

export type ShopifyFieldStateDb = PrismaClient | Prisma.TransactionClient;

/**
 * Seed BASE=LOCAL=REMOTE for core content fields at mapping / first convergence.
 * Enables subsequent field-level adaptive merge without group-fingerprint guessing.
 */
export async function seedShopifyListingFieldConvergence(
  db: ShopifyFieldStateDb,
  input: {
    connectionId: string;
    listingLinkId: string;
    memberId: string;
    storeItemId: string;
    storeVariantId: string;
    title: string;
    description: string | null;
    priceCents: number;
    sku: string | null;
  }
): Promise<void> {
  const rows: Array<{
    fieldKey: ShopifyContentFieldKey;
    storeVariantId: string;
    fingerprint: string;
  }> = [
    {
      fieldKey: "TITLE",
      storeVariantId: "",
      fingerprint: shopifyFieldFingerprint("TITLE", input.title),
    },
    {
      fieldKey: "DESCRIPTION",
      storeVariantId: "",
      fingerprint: shopifyDescriptionFieldFingerprint(input.description),
    },
    {
      fieldKey: "PRICE",
      storeVariantId: input.storeVariantId,
      fingerprint: shopifyFieldFingerprint("PRICE", input.priceCents),
    },
    {
      fieldKey: "SKU",
      storeVariantId: input.storeVariantId,
      fingerprint: shopifyFieldFingerprint("SKU", input.sku),
    },
  ];

  for (const row of rows) {
    await db.shopifyListingFieldState.upsert({
      where: {
        shopifyListingLinkId_storeVariantId_fieldKey: {
          shopifyListingLinkId: input.listingLinkId,
          storeVariantId: row.storeVariantId,
          fieldKey: row.fieldKey,
        },
      },
      create: {
        shopifyConnectionId: input.connectionId,
        shopifyListingLinkId: input.listingLinkId,
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        storeVariantId: row.storeVariantId,
        fieldKey: row.fieldKey,
        baseFingerprint: row.fingerprint,
        localFingerprint: row.fingerprint,
        remoteFingerprint: row.fingerprint,
        conflict: false,
      },
      update: {
        baseFingerprint: row.fingerprint,
        localFingerprint: row.fingerprint,
        remoteFingerprint: row.fingerprint,
        conflict: false,
        conflictRemoteFingerprint: null,
        conflictEvidenceId: null,
        conflictDetectedAt: null,
      },
    });
  }
}

/**
 * Upsert per-field BASE/LOCAL/REMOTE fingerprints and conflict flags from a plan.
 * BASE advances to the converged fingerprint only for CONVERGED/UNCHANGED here;
 * PUSH/PULL callers must call markShopifyFieldsApplied after successful apply.
 */
export async function persistShopifyFieldPlans(
  db: ShopifyFieldStateDb,
  input: {
    connectionId: string;
    listingLinkId: string;
    memberId: string;
    storeItemId: string;
    plans: ShopifyFieldPlan[];
    evidenceId?: string | null;
    now?: Date;
  }
): Promise<void> {
  const now = input.now ?? new Date();
  for (const plan of input.plans) {
    const conflict = plan.action === "CONFLICT";
    const converged = plan.action === "CONVERGED" || plan.action === "UNCHANGED";
    await db.shopifyListingFieldState.upsert({
      where: {
        shopifyListingLinkId_storeVariantId_fieldKey: {
          shopifyListingLinkId: input.listingLinkId,
          storeVariantId: plan.storeVariantId,
          fieldKey: plan.field as ShopifyContentFieldKey,
        },
      },
      create: {
        shopifyConnectionId: input.connectionId,
        shopifyListingLinkId: input.listingLinkId,
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        storeVariantId: plan.storeVariantId,
        fieldKey: plan.field as ShopifyContentFieldKey,
        baseFingerprint: converged ? plan.local : plan.base,
        localFingerprint: plan.local,
        remoteFingerprint: plan.remote,
        conflict,
        conflictRemoteFingerprint: conflict ? plan.remote : null,
        conflictEvidenceId: conflict ? (input.evidenceId ?? null) : null,
        conflictDetectedAt: conflict ? now : null,
      },
      update: {
        localFingerprint: plan.local,
        remoteFingerprint: plan.remote,
        ...(converged ? { baseFingerprint: plan.local } : {}),
        conflict,
        conflictRemoteFingerprint: conflict ? plan.remote : null,
        conflictEvidenceId: conflict ? (input.evidenceId ?? null) : null,
        conflictDetectedAt: conflict ? now : null,
      },
    });
  }
}

/** Mark fields as applied (BASE = LOCAL = REMOTE fingerprint). */
export async function markShopifyFieldsApplied(
  db: ShopifyFieldStateDb,
  input: {
    listingLinkId: string;
    fields: Array<{ field: ShopifyContentFieldKey; storeVariantId?: string; fingerprint: string }>;
  }
): Promise<void> {
  for (const row of input.fields) {
    await db.shopifyListingFieldState.updateMany({
      where: {
        shopifyListingLinkId: input.listingLinkId,
        storeVariantId: row.storeVariantId ?? "",
        fieldKey: row.field,
      },
      data: {
        baseFingerprint: row.fingerprint,
        localFingerprint: row.fingerprint,
        remoteFingerprint: row.fingerprint,
        conflict: false,
        conflictRemoteFingerprint: null,
        conflictEvidenceId: null,
        conflictDetectedAt: null,
      },
    });
  }
}

export async function loadShopifyFieldStates(
  db: ShopifyFieldStateDb,
  listingLinkId: string
): Promise<
  Array<{
    fieldKey: ShopifyContentFieldKey;
    storeVariantId: string;
    baseFingerprint: string | null;
    localFingerprint: string | null;
    remoteFingerprint: string | null;
    conflict: boolean;
  }>
> {
  return db.shopifyListingFieldState.findMany({
    where: { shopifyListingLinkId: listingLinkId },
    select: {
      fieldKey: true,
      storeVariantId: true,
      baseFingerprint: true,
      localFingerprint: true,
      remoteFingerprint: true,
      conflict: true,
    },
  });
}
