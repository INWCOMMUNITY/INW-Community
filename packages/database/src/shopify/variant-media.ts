import type { Prisma, PrismaClient } from "@prisma/client";
import { classifyShopifyContentSemantics } from "./content-semantic";
import {
  markShopifyFieldsApplied,
  persistShopifyFieldPlans,
} from "./field-state";
import { shopifyMediaIdentityFingerprint } from "./media-map";
import { planShopifyFieldLevelSync } from "./field-semantic";

/**
 * Variant ↔ Media association using existing marketplace-neutral models:
 * - StoreVariant.photos (canonical URLs ordered; supports shared media)
 * - ShopifyMediaMap.storeVariantId (optional unique-association hint)
 *
 * No Shopify-only pseudo-canonical field is invented.
 * Per-variant BASE uses ShopifyListingFieldState(MEDIA, storeVariantId=variantId).
 */

export type VariantMediaAssociationPlan = {
  storeVariantId: string;
  inwMediaIds: string[];
  shopifyMediaIds: string[];
};

export type ShopifyVariantMediaInboundDb = PrismaClient | Prisma.TransactionClient;

export type VariantMediaInboundClass =
  | "UNCHANGED"
  | "CONVERGED"
  | "LOCAL_ONLY"
  | "REMOTE_ONLY"
  | "CONFLICT"
  | "SKIP_UNMAPPED_MEDIA";

/**
 * Plan associations from StoreVariant.photos against durable product media maps.
 * Matches by sourceUrl → inwMediaId → shopifyMediaId when mapped.
 */
export function planVariantMediaAssociations(input: {
  variants: Array<{ storeVariantId: string; photos: string[] }>;
  mediaMaps: Array<{
    inwMediaId: string;
    sourceUrl: string | null;
    shopifyMediaId: string | null;
    status: string;
  }>;
}): VariantMediaAssociationPlan[] {
  const active = input.mediaMaps.filter((m) => m.status === "ACTIVE");
  const byUrl = new Map(
    active
      .filter((m) => m.sourceUrl?.trim())
      .map((m) => [m.sourceUrl!.trim(), m] as const)
  );

  return input.variants.map((variant) => {
    const inwMediaIds: string[] = [];
    const shopifyMediaIds: string[] = [];
    for (const photo of variant.photos) {
      const url = typeof photo === "string" ? photo.trim() : "";
      if (!url) continue;
      const map = byUrl.get(url);
      if (!map) continue;
      inwMediaIds.push(map.inwMediaId);
      if (map.shopifyMediaId) shopifyMediaIds.push(map.shopifyMediaId);
    }
    return {
      storeVariantId: variant.storeVariantId,
      inwMediaIds,
      shopifyMediaIds,
    };
  });
}

/**
 * Plan inbound associations from remote ProductVariant media GIDs.
 * Identity is ProductVariant GID + Media GID only — never SKU.
 */
export function planVariantMediaInboundAssociations(input: {
  mappedVariants: Array<{ storeVariantId: string; shopifyVariantId: string }>;
  remoteVariantMedia: Array<{ shopifyVariantId: string; shopifyMediaIds: string[] }>;
  mediaMaps: Array<{
    inwMediaId: string;
    sourceUrl: string | null;
    shopifyMediaId: string | null;
    status: string;
  }>;
}): Array<{
  storeVariantId: string;
  shopifyVariantId: string;
  photos: string[];
  inwMediaIds: string[];
  shopifyMediaIds: string[];
  unresolvedMediaIds: string[];
}> {
  const active = input.mediaMaps.filter((m) => m.status === "ACTIVE" && m.shopifyMediaId);
  const byMediaGid = new Map(active.map((m) => [m.shopifyMediaId!, m] as const));
  const remoteByVariant = new Map(
    input.remoteVariantMedia.map((row) => [row.shopifyVariantId, row.shopifyMediaIds] as const)
  );

  return input.mappedVariants.map((variant) => {
    const mediaIds = remoteByVariant.get(variant.shopifyVariantId) ?? [];
    const photos: string[] = [];
    const inwMediaIds: string[] = [];
    const shopifyMediaIds: string[] = [];
    const unresolvedMediaIds: string[] = [];
    for (const mediaId of mediaIds) {
      const map = byMediaGid.get(mediaId);
      if (!map) {
        unresolvedMediaIds.push(mediaId);
        continue;
      }
      shopifyMediaIds.push(mediaId);
      inwMediaIds.push(map.inwMediaId);
      if (map.sourceUrl?.trim()) photos.push(map.sourceUrl.trim());
    }
    return {
      storeVariantId: variant.storeVariantId,
      shopifyVariantId: variant.shopifyVariantId,
      photos,
      inwMediaIds,
      shopifyMediaIds,
      unresolvedMediaIds,
    };
  });
}

/** Local association fingerprint from StoreVariant.photos via durable maps. */
export function variantMediaLocalFingerprint(input: {
  photos: string[];
  mediaMaps: Array<{
    inwMediaId: string;
    sourceUrl: string | null;
    shopifyMediaId: string | null;
    status: string;
  }>;
}): string {
  const plan = planVariantMediaAssociations({
    variants: [{ storeVariantId: "_", photos: input.photos }],
    mediaMaps: input.mediaMaps,
  })[0];
  return shopifyMediaIdentityFingerprint(plan?.inwMediaIds ?? []);
}

export function variantMediaRemoteFingerprint(inwMediaIds: string[]): string {
  return shopifyMediaIdentityFingerprint(inwMediaIds);
}

/**
 * Pure per-variant classifier for tests and apply.
 * BASE is last applied association fingerprint (MEDIA field state for that StoreVariant).
 */
export function classifyVariantMediaInbound(input: {
  base: string | null;
  local: string;
  remote: string;
  hasLocalSemanticEdit?: boolean;
  /** Remote referenced media GIDs that are not yet in ShopifyMediaMap. */
  unresolvedRemoteMedia?: boolean;
}): VariantMediaInboundClass {
  if (input.unresolvedRemoteMedia) return "SKIP_UNMAPPED_MEDIA";
  return classifyShopifyContentSemantics({
    base: input.base,
    local: input.local,
    remote: input.remote,
    hasLocalSemanticEdit: input.hasLocalSemanticEdit,
  });
}

/**
 * Apply Shopify→INW variant media associations after product media maps exist.
 * Uses BASE/LOCAL/REMOTE; never LWW; never SKU identity; never deletes product media.
 */
export async function applyShopifyVariantMediaInbound(
  db: ShopifyVariantMediaInboundDb,
  input: {
    connectionId: string;
    listingLinkId: string;
    memberId: string;
    storeItemId: string;
    evidenceId?: string | null;
    mappedVariants: Array<{ storeVariantId: string; shopifyVariantId: string }>;
    remoteVariantMedia: Array<{ shopifyVariantId: string; shopifyMediaIds: string[] }>;
  }
): Promise<{
  action: string;
  updatedVariants: number;
  conflicts: number;
  echoes: number;
  skippedUnresolved: number;
}> {
  if (input.mappedVariants.length < 1) {
    return {
      action: "VARIANT_MEDIA_SKIPPED",
      updatedVariants: 0,
      conflicts: 0,
      echoes: 0,
      skippedUnresolved: 0,
    };
  }

  // Only process variants that appear in the remote observation set (mapped + observed).
  const observedRemoteIds = new Set(input.remoteVariantMedia.map((r) => r.shopifyVariantId));
  const activeMapped = input.mappedVariants.filter((m) => observedRemoteIds.has(m.shopifyVariantId));
  if (activeMapped.length < 1) {
    return {
      action: "VARIANT_MEDIA_SKIPPED",
      updatedVariants: 0,
      conflicts: 0,
      echoes: 0,
      skippedUnresolved: 0,
    };
  }

  const mediaMaps = await db.shopifyMediaMap.findMany({
    where: { shopifyListingLinkId: input.listingLinkId, status: "ACTIVE" },
    select: {
      id: true,
      inwMediaId: true,
      sourceUrl: true,
      shopifyMediaId: true,
      status: true,
      storeVariantId: true,
    },
  });

  const plans = planVariantMediaInboundAssociations({
    mappedVariants: activeMapped,
    remoteVariantMedia: input.remoteVariantMedia,
    mediaMaps,
  });

  const fieldStates = await db.shopifyListingFieldState.findMany({
    where: {
      shopifyListingLinkId: input.listingLinkId,
      fieldKey: "MEDIA",
      storeVariantId: { in: activeMapped.map((m) => m.storeVariantId) },
    },
  });
  const fieldByVariant = new Map(fieldStates.map((s) => [s.storeVariantId, s]));

  let updatedVariants = 0;
  let conflicts = 0;
  let echoes = 0;
  let skippedUnresolved = 0;
  const actions: string[] = [];

  // How many variants claim each media (for shared-media storeVariantId hints).
  const claimCount = new Map<string, number>();
  for (const plan of plans) {
    for (const id of plan.inwMediaIds) {
      claimCount.set(id, (claimCount.get(id) ?? 0) + 1);
    }
  }

  for (const plan of plans) {
    const storeVariant = await db.storeVariant.findFirst({
      where: {
        id: plan.storeVariantId,
        storeItemId: input.storeItemId,
        memberId: input.memberId,
      },
      select: { id: true, photos: true },
    });
    if (!storeVariant) continue;

    const localFp = variantMediaLocalFingerprint({
      photos: storeVariant.photos ?? [],
      mediaMaps,
    });
    const remoteFp = variantMediaRemoteFingerprint(plan.inwMediaIds);
    const field = fieldByVariant.get(plan.storeVariantId);
    const base = field?.baseFingerprint ?? null;
    const hasLocalSemanticEdit = Boolean(
      field?.localFingerprint && field.localFingerprint !== field.baseFingerprint
    );

    const cls = classifyVariantMediaInbound({
      base,
      local: localFp,
      remote: remoteFp,
      hasLocalSemanticEdit,
      // Wait for product-media ingest to canonicalize every referenced Media GID.
      unresolvedRemoteMedia: plan.unresolvedMediaIds.length > 0,
    });

    if (cls === "SKIP_UNMAPPED_MEDIA") {
      skippedUnresolved += 1;
      actions.push("SKIP_UNMAPPED");
      continue;
    }

    const syncPlan = planShopifyFieldLevelSync([
      {
        field: "MEDIA",
        storeVariantId: plan.storeVariantId,
        base,
        local: localFp,
        remote: remoteFp,
        hasLocalSemanticEdit,
      },
    ]);

    await persistShopifyFieldPlans(db, {
      connectionId: input.connectionId,
      listingLinkId: input.listingLinkId,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      plans: syncPlan.plans,
      evidenceId: input.evidenceId ?? null,
    });

    if (cls === "CONFLICT") {
      conflicts += 1;
      actions.push("CONFLICT");
      continue;
    }

    if (cls === "LOCAL_ONLY") {
      // Outbound sync owns the push; do not overwrite local association.
      actions.push("LOCAL_ONLY");
      continue;
    }

    if (cls === "UNCHANGED") {
      echoes += 1;
      actions.push("ECHO");
      // Confirm BASE=LOCAL=REMOTE (self-echo / idempotent replay).
      await markShopifyFieldsApplied(db, {
        listingLinkId: input.listingLinkId,
        fields: [{ field: "MEDIA", storeVariantId: plan.storeVariantId, fingerprint: localFp }],
      });
      // Refresh unique association hints without touching photos.
      await rebindUniqueMediaHints(db, {
        listingLinkId: input.listingLinkId,
        storeVariantId: plan.storeVariantId,
        inwMediaIds: plan.inwMediaIds,
        claimCount,
      });
      continue;
    }

    // REMOTE_ONLY or CONVERGED → pull remote association into exact Variant.
    const samePhotos =
      storeVariant.photos.length === plan.photos.length &&
      storeVariant.photos.every((url, i) => url === plan.photos[i]);

    if (!samePhotos) {
      await db.storeVariant.update({
        where: { id: plan.storeVariantId },
        data: { photos: plan.photos },
      });
      updatedVariants += 1;
    }

    // Clear this variant's prior unique hints, then rebind (never delete product media maps).
    await db.shopifyMediaMap.updateMany({
      where: {
        shopifyListingLinkId: input.listingLinkId,
        storeVariantId: plan.storeVariantId,
      },
      data: { storeVariantId: null },
    });
    await rebindUniqueMediaHints(db, {
      listingLinkId: input.listingLinkId,
      storeVariantId: plan.storeVariantId,
      inwMediaIds: plan.inwMediaIds,
      claimCount,
    });

    await markShopifyFieldsApplied(db, {
      listingLinkId: input.listingLinkId,
      fields: [{ field: "MEDIA", storeVariantId: plan.storeVariantId, fingerprint: remoteFp }],
    });

    actions.push(cls === "CONVERGED" ? "CONVERGED" : "PULL");
    if (samePhotos) echoes += 1;
  }

  const action =
    conflicts > 0
      ? "VARIANT_MEDIA_CONFLICT"
      : updatedVariants > 0
        ? "VARIANT_MEDIA_APPLIED"
        : echoes > 0
          ? "VARIANT_MEDIA_ECHO"
          : skippedUnresolved > 0
            ? "VARIANT_MEDIA_PENDING_MEDIA"
            : "VARIANT_MEDIA_UNCHANGED";

  return { action, updatedVariants, conflicts, echoes, skippedUnresolved };
}

async function rebindUniqueMediaHints(
  db: ShopifyVariantMediaInboundDb,
  input: {
    listingLinkId: string;
    storeVariantId: string;
    inwMediaIds: string[];
    claimCount: Map<string, number>;
  }
): Promise<void> {
  for (const inwMediaId of input.inwMediaIds) {
    // Shared media across variants: leave storeVariantId null; photos remain authoritative.
    if ((input.claimCount.get(inwMediaId) ?? 0) !== 1) continue;
    await db.shopifyMediaMap.updateMany({
      where: {
        shopifyListingLinkId: input.listingLinkId,
        inwMediaId,
      },
      data: { storeVariantId: input.storeVariantId },
    });
  }
}

/**
 * Seed BASE=LOCAL=REMOTE variant-media association at import/export mapping time.
 * Does not enqueue outbound media association jobs.
 */
export async function seedShopifyVariantMediaConvergence(
  db: ShopifyVariantMediaInboundDb,
  input: {
    connectionId: string;
    listingLinkId: string;
    memberId: string;
    storeItemId: string;
    associations: Array<{
      storeVariantId: string;
      photos: string[];
      inwMediaIds: string[];
    }>;
  }
): Promise<void> {
  const claimCount = new Map<string, number>();
  for (const row of input.associations) {
    for (const id of row.inwMediaIds) {
      claimCount.set(id, (claimCount.get(id) ?? 0) + 1);
    }
  }

  for (const row of input.associations) {
    await db.storeVariant.update({
      where: { id: row.storeVariantId },
      data: { photos: row.photos },
    });
    const fp = shopifyMediaIdentityFingerprint(row.inwMediaIds);
    await persistShopifyFieldPlans(db, {
      connectionId: input.connectionId,
      listingLinkId: input.listingLinkId,
      memberId: input.memberId,
      storeItemId: input.storeItemId,
      plans: [
        {
          field: "MEDIA",
          storeVariantId: row.storeVariantId,
          class: "UNCHANGED",
          action: "UNCHANGED",
          base: fp,
          local: fp,
          remote: fp,
        },
      ],
    });
    await markShopifyFieldsApplied(db, {
      listingLinkId: input.listingLinkId,
      fields: [{ field: "MEDIA", storeVariantId: row.storeVariantId, fingerprint: fp }],
    });
    await db.shopifyMediaMap.updateMany({
      where: {
        shopifyListingLinkId: input.listingLinkId,
        storeVariantId: row.storeVariantId,
      },
      data: { storeVariantId: null },
    });
    await rebindUniqueMediaHints(db, {
      listingLinkId: input.listingLinkId,
      storeVariantId: row.storeVariantId,
      inwMediaIds: row.inwMediaIds,
      claimCount,
    });
  }
}
