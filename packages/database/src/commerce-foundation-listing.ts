import type { Prisma } from "@prisma/client";
import { analyzeStoreItem } from "./foundation/backfill/analyze";
import { matrixFingerprint } from "./foundation/backfill/analyze";
import type { PlannedVariant } from "./foundation/backfill/types";
import {
  FOUNDATION_SOURCE_SYSTEM,
  FoundationInventoryError,
  FoundationMissingStateError,
  FoundationRestockReviewError,
  NATIVE_OPENING_SCOPE,
  appendInventoryEvent,
  lockCutoverShare,
  lockStoreItemForUpdate,
  projectStoreItemQuantity,
  restockTrackedVariant,
  setTrackedOnHand,
} from "./commerce-foundation-inventory";
import { resolveCheckoutVariant, type FoundationDb } from "./commerce-foundation-variant-resolution";

function asLegacyItem(item: {
  id: string;
  memberId: string;
  sku: string | null;
  barcode: string | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  photos: string[];
  quantity: number;
  inventoryTracking: string;
  status: string;
  endedAt: Date | null;
  variants: Prisma.JsonValue | null;
}) {
  return { ...item, variants: item.variants };
}

function optionFingerprintOf(raw: Prisma.JsonValue): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const options: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const name = String(k ?? "").trim();
    const val = v != null ? String(v).trim() : "";
    if (name && val) options[name] = val;
  }
  return Object.keys(options).length === 0 ? "simple:default" : matrixFingerprint(options);
}

export async function provisionNativeFoundationListing(
  tx: FoundationDb,
  storeItemId: string
): Promise<{ variantIds: string[]; kind: "simple" | "matrix" }> {
  await lockCutoverShare(tx);
  await lockStoreItemForUpdate(tx, storeItemId);
  const item = await tx.storeItem.findUnique({ where: { id: storeItemId } });
  if (!item) {
    throw new FoundationMissingStateError(`StoreItem ${storeItemId} not found`);
  }
  const existing = await tx.storeVariant.count({ where: { storeItemId } });
  if (existing > 0) {
    throw new FoundationInventoryError(
      "listing_already_provisioned",
      `StoreItem ${storeItemId} already has Variants`
    );
  }
  const plan = analyzeStoreItem(asLegacyItem(item));
  const variantIds: string[] = [];
  for (const planned of plan.variants) {
    const variantId = await createNativeVariant(tx, plan.memberId, storeItemId, planned, plan.mode, plan.variantStatus);
    variantIds.push(variantId);
  }
  await projectStoreItemQuantity(tx, storeItemId);
  return { variantIds, kind: plan.kind };
}

async function createNativeVariant(
  tx: FoundationDb,
  memberId: string,
  storeItemId: string,
  planned: PlannedVariant,
  mode: "TRACKED_FINITE" | "MADE_TO_ORDER",
  variantStatus: "ACTIVE" | "RETIRED"
): Promise<string> {
  const variant = await tx.storeVariant.create({
    data: {
      memberId,
      storeItemId,
      status: variantStatus,
      isDefault: planned.isDefault,
      sku: planned.sku,
      barcode: planned.barcode,
      options: planned.options,
      priceCents: planned.priceCents,
      compareAtPriceCents: planned.compareAtPriceCents,
      photos: planned.photos,
      offerVersion: 1,
      sortOrder: planned.sortOrder,
    },
  });
  await tx.inventoryState.create({
    data: {
      variantId: variant.id,
      memberId,
      storeItemId,
      mode,
      onHand: mode === "TRACKED_FINITE" ? planned.openingQty ?? 0 : null,
      reserved: mode === "TRACKED_FINITE" ? 0 : null,
      availabilityVersion: 1,
    },
  });
  if (mode === "TRACKED_FINITE") {
    const qty = planned.openingQty ?? 0;
    await appendInventoryEvent(tx, {
      memberId,
      variantId: variant.id,
      storeItemId,
      eventType: "OPENING_BALANCE",
      cause: "SELLER",
      sourceSystem: FOUNDATION_SOURCE_SYSTEM,
      sourceScope: NATIVE_OPENING_SCOPE,
      sourceFactId: `opening:${variant.id}`,
      requestedQty: qty,
      appliedOnHandQty: qty,
      appliedReservedQty: 0,
      onHandBefore: null,
      onHandAfter: qty,
      reservedBefore: null,
      reservedAfter: 0,
      metadata: { fingerprint: planned.fingerprint, native: true },
    });
  }
  return variant.id;
}

export async function restockFoundationOrderLine(
  tx: FoundationDb,
  line: {
    id?: string | null;
    storeItemId: string;
    quantity: number;
    variant?: unknown;
    variantId?: string | null;
  },
  kind: "PHYSICAL_RECEIPT" | "UNDO_CONSUMPTION",
  operationId: string
): Promise<void> {
  await lockCutoverShare(tx);
  if (!operationId.trim()) {
    throw new FoundationRestockReviewError("Restock requires a durable operation identity");
  }
  let variantId = line.variantId ?? null;
  if (!variantId) {
    try {
      const resolved = await resolveCheckoutVariant(tx, line.storeItemId, {
        variantId: null,
        optionJson: line.variant,
      });
      variantId = resolved.id;
    } catch {
      throw new FoundationRestockReviewError(
        `Cannot safely restock StoreItem ${line.storeItemId} without a resolvable Variant`
      );
    }
  }
  if (!line.id) {
    throw new FoundationRestockReviewError("Restock requires a durable OrderItem id");
  }
  const state = await tx.inventoryState.findUnique({
    where: { variantId },
    select: { mode: true },
  });
  if (state?.mode === "MADE_TO_ORDER") {
    return;
  }
  await restockTrackedVariant(tx, {
    variantId,
    qty: line.quantity,
    kind,
    sourceFactId: `${operationId}:${line.id}:${kind}`,
    orderItemId: line.id,
  });
}

export async function applyFoundationSellerQuantitySets(
  tx: FoundationDb,
  args: {
    storeItemId: string;
    memberId: string;
    commandId: string;
    simpleTarget?: number;
    matrixTargets?: Array<{ fingerprint: string; targetOnHand: number }>;
  }
): Promise<void> {
  await lockCutoverShare(tx);
  await lockStoreItemForUpdate(tx, args.storeItemId);
  // RETIRED variants (e.g. Shopify GID replaced during topology sync) must not
  // participate in structure checks or quantity SET fan-out.
  const variants = await tx.storeVariant.findMany({
    where: { storeItemId: args.storeItemId, status: "ACTIVE" },
  });
  if (variants.length === 0) {
    throw new FoundationMissingStateError(`StoreItem ${args.storeItemId} has no Variants`);
  }
  if (args.matrixTargets) {
    const byFp = new Map(variants.map((v) => [optionFingerprintOf(v.options), v]));
    for (const target of args.matrixTargets) {
      const variant = byFp.get(target.fingerprint);
      if (!variant) {
        throw new FoundationInventoryError(
          "structural_variant_change",
          `No existing Variant for fingerprint ${target.fingerprint}`
        );
      }
      await setTrackedOnHand(tx, {
        variantId: variant.id,
        targetOnHand: target.targetOnHand,
        commandId: `${args.commandId}:${variant.id}`,
        memberId: args.memberId,
      });
    }
    return;
  }
  if (args.simpleTarget == null) {
    throw new FoundationInventoryError("missing_set_target", "SIMPLE SET requires a target onHand");
  }
  if (variants.length !== 1) {
    throw new FoundationInventoryError(
      "ambiguous_bulk_quantity",
      "Cannot apply a single quantity to a matrix listing"
    );
  }
  const defaults = variants.filter((v) => v.isDefault);
  if (defaults.length !== 1) {
    throw new FoundationMissingStateError("SIMPLE listing must have exactly one default Variant");
  }
  await setTrackedOnHand(tx, {
    variantId: defaults[0].id,
    targetOnHand: args.simpleTarget,
    commandId: args.commandId,
    memberId: args.memberId,
  });
}

export function assertNoStructuralVariantChange(
  existingFingerprints: string[],
  nextFingerprints: string[]
): void {
  const a = [...existingFingerprints].sort();
  const b = [...nextFingerprints].sort();
  if (a.length !== b.length || a.some((fp, i) => fp !== b[i])) {
    throw new FoundationInventoryError(
      "structural_variant_change",
      "FOUNDATION seller edit cannot add, remove, or replace Variant identity"
    );
  }
}

export async function assertFoundationMatrixStructureUnchanged(
  tx: FoundationDb,
  storeItemId: string,
  nextFingerprints: string[]
): Promise<void> {
  const variants = await tx.storeVariant.findMany({
    where: { storeItemId, status: "ACTIVE" },
  });
  assertNoStructuralVariantChange(
    variants.map((variant) => optionFingerprintOf(variant.options)),
    nextFingerprints
  );
}

export type FoundationMatrixSkuTarget = {
  fingerprint: string;
  options: Record<string, string>;
  targetOnHand: number;
  priceCents: number;
  sku: string | null;
};

/**
 * Seller matrix topology edit: add / remove / replace Variant identity to match
 * the next option-combination set. Creates InventoryState for new rows, retires
 * removed ACTIVE rows, reactivates matching RETIRED rows, then SETs onHand.
 */
export async function applyFoundationSellerMatrixStructure(
  tx: FoundationDb,
  args: {
    storeItemId: string;
    memberId: string;
    commandId: string;
    matrixTargets: FoundationMatrixSkuTarget[];
  }
): Promise<{ created: number; retired: number; reactivated: number; structureChanged: boolean }> {
  await lockCutoverShare(tx);
  await lockStoreItemForUpdate(tx, args.storeItemId);

  if (args.matrixTargets.length < 1) {
    throw new FoundationInventoryError(
      "structural_variant_change",
      "Matrix edit requires at least one variant combination"
    );
  }
  if (args.matrixTargets.length > 100) {
    throw new FoundationInventoryError(
      "structural_variant_change",
      "Matrix edit exceeds 100 variant combinations"
    );
  }

  const nextFingerprints = args.matrixTargets.map((t) => t.fingerprint);
  const unique = new Set(nextFingerprints);
  if (unique.size !== nextFingerprints.length) {
    throw new FoundationInventoryError(
      "structural_variant_change",
      "Matrix edit has duplicate option combinations"
    );
  }

  const item = await tx.storeItem.findUnique({
    where: { id: args.storeItemId },
    select: {
      id: true,
      memberId: true,
      inventoryTracking: true,
      photos: true,
      compareAtPriceCents: true,
    },
  });
  if (!item || item.memberId !== args.memberId) {
    throw new FoundationMissingStateError(`StoreItem ${args.storeItemId} not found`);
  }
  const mode =
    item.inventoryTracking === "made_to_order" ? "MADE_TO_ORDER" : "TRACKED_FINITE";

  const existing = await tx.storeVariant.findMany({
    where: { storeItemId: args.storeItemId },
    orderBy: { createdAt: "asc" },
  });
  const activeBefore = existing.filter((v) => v.status === "ACTIVE");
  const beforeFingerprints = activeBefore.map((v) => optionFingerprintOf(v.options)).sort();
  const afterFingerprints = [...nextFingerprints].sort();
  const structureChanged =
    beforeFingerprints.length !== afterFingerprints.length ||
    beforeFingerprints.some((fp, i) => fp !== afterFingerprints[i]);

  const byFp = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    const fp = optionFingerprintOf(row.options);
    const prior = byFp.get(fp);
    // Prefer ACTIVE over RETIRED when duplicate fingerprints exist historically.
    if (!prior || (prior.status !== "ACTIVE" && row.status === "ACTIVE")) {
      byFp.set(fp, row);
    }
  }

  let created = 0;
  let reactivated = 0;
  let sortOrder = existing.reduce((max, v) => Math.max(max, v.sortOrder ?? 0), 0);

  for (const target of args.matrixTargets) {
    const opts = target.options;
    const optionKeys = Object.keys(opts);
    if (optionKeys.length < 1) {
      throw new FoundationInventoryError(
        "structural_variant_change",
        "Matrix variant is missing option values"
      );
    }
    const priceCents =
      Number.isFinite(target.priceCents) && target.priceCents > 0
        ? Math.round(target.priceCents)
        : 1;
    const sku = target.sku?.trim() || null;
    const onHand = Math.max(0, Math.trunc(target.targetOnHand));
    let row = byFp.get(target.fingerprint);

    if (!row) {
      sortOrder += 1;
      const planned: PlannedVariant = {
        fingerprint: target.fingerprint,
        isDefault: false,
        sku,
        barcode: null,
        options: opts,
        priceCents,
        compareAtPriceCents: item.compareAtPriceCents,
        photos: item.photos ?? [],
        sortOrder,
        openingQty: mode === "TRACKED_FINITE" ? onHand : null,
      };
      const variantId = await createNativeVariant(
        tx,
        args.memberId,
        args.storeItemId,
        planned,
        mode,
        "ACTIVE"
      );
      row = await tx.storeVariant.findUniqueOrThrow({ where: { id: variantId } });
      byFp.set(target.fingerprint, row);
      created += 1;
    } else if (row.status !== "ACTIVE") {
      await tx.storeVariant.update({
        where: { id: row.id },
        data: {
          status: "ACTIVE",
          retiredAt: null,
          priceCents,
          sku,
          options: opts,
          isDefault: false,
        },
      });
      reactivated += 1;
      row = { ...row, status: "ACTIVE", priceCents, sku, options: opts, isDefault: false };
      byFp.set(target.fingerprint, row);
    } else {
      if (row.priceCents !== priceCents || row.sku !== sku) {
        await tx.storeVariant.update({
          where: { id: row.id },
          data: { priceCents, sku, options: opts, isDefault: false },
        });
      } else if (row.isDefault) {
        await tx.storeVariant.update({
          where: { id: row.id },
          data: { isDefault: false, options: opts },
        });
      }
    }

    if (mode === "TRACKED_FINITE") {
      await setTrackedOnHand(tx, {
        variantId: row.id,
        targetOnHand: onHand,
        commandId: `${args.commandId}:${row.id}`,
        memberId: args.memberId,
      });
    }
  }

  const nextSet = new Set(nextFingerprints);
  const toRetire = activeBefore.filter((v) => !nextSet.has(optionFingerprintOf(v.options)));
  let retired = 0;
  if (toRetire.length > 0) {
    const retireIds = toRetire.map((v) => v.id);
    const now = new Date();
    await tx.storeVariant.updateMany({
      where: { id: { in: retireIds } },
      data: { status: "RETIRED", retiredAt: now },
    });
    retired = retireIds.length;
    // Drop marketplace maps for retired identities so outbound remesh can rebuild.
    await tx.etsyVariantMap.deleteMany({ where: { storeVariantId: { in: retireIds } } });
    await tx.shopifyVariantMap.deleteMany({ where: { storeVariantId: { in: retireIds } } });
  }

  await projectStoreItemQuantity(tx, args.storeItemId);
  return { created, retired, reactivated, structureChanged };
}

export async function markFoundationListingSold(
  tx: FoundationDb,
  args: { storeItemId: string; memberId: string; commandId: string }
): Promise<void> {
  await lockCutoverShare(tx);
  await lockStoreItemForUpdate(tx, args.storeItemId);
  const variants = await tx.storeVariant.findMany({
    where: { storeItemId: args.storeItemId, status: "ACTIVE" },
  });
  if (variants.length === 0) {
    throw new FoundationMissingStateError(`StoreItem ${args.storeItemId} has no Variants`);
  }
  for (const variant of variants) {
    const state = await tx.inventoryState.findUnique({ where: { variantId: variant.id } });
    if (!state) {
      throw new FoundationMissingStateError(`InventoryState missing for Variant ${variant.id}`);
    }
    if (state.mode === "TRACKED_FINITE") {
      await setTrackedOnHand(tx, {
        variantId: variant.id,
        targetOnHand: 0,
        commandId: `${args.commandId}:${variant.id}`,
        memberId: args.memberId,
        cause: "SELLER",
      });
    }
  }
  await tx.storeItem.update({
    where: { id: args.storeItemId },
    data: { status: "sold_out" },
  });
}

export async function endFoundationListing(
  tx: FoundationDb,
  args: { storeItemId: string; currentStatus: string }
): Promise<void> {
  await lockCutoverShare(tx);
  await lockStoreItemForUpdate(tx, args.storeItemId);
  const variants = await tx.storeVariant.findMany({ where: { storeItemId: args.storeItemId } });
  if (variants.length === 0) {
    throw new FoundationMissingStateError(`StoreItem ${args.storeItemId} has no Variants`);
  }
  const now = new Date();
  await tx.storeItem.update({
    where: { id: args.storeItemId },
    data: {
      status: "inactive",
      ...(args.currentStatus !== "inactive" ? { endedAt: now } : {}),
    },
  });
  await tx.storeVariant.updateMany({
    where: { storeItemId: args.storeItemId, status: "ACTIVE" },
    data: { status: "RETIRED", retiredAt: now },
  });
}

export async function relistFoundationListing(
  tx: FoundationDb,
  args: {
    storeItemId: string;
    memberId: string;
    commandId: string;
    simpleTarget?: number;
    matrixTargets?: Array<{ fingerprint: string; targetOnHand: number }>;
  }
): Promise<void> {
  await lockCutoverShare(tx);
  await lockStoreItemForUpdate(tx, args.storeItemId);
  await tx.storeItem.update({
    where: { id: args.storeItemId },
    data: { status: "active", endedAt: null },
  });
  // Only reactivate variants that are part of this relist SET. Do not resurrect
  // topology-retired orphans (Shopify GID replaced) that are absent from targets.
  const allVariants = await tx.storeVariant.findMany({
    where: { storeItemId: args.storeItemId },
    select: { id: true, options: true, isDefault: true, status: true },
  });
  const reactivateIds = new Set<string>();
  if (args.matrixTargets) {
    const byFp = new Map(allVariants.map((v) => [optionFingerprintOf(v.options), v]));
    for (const target of args.matrixTargets) {
      const variant = byFp.get(target.fingerprint);
      if (variant) reactivateIds.add(variant.id);
    }
  } else {
    const defaults = allVariants.filter((v) => v.isDefault);
    if (defaults.length === 1) reactivateIds.add(defaults[0]!.id);
  }
  if (reactivateIds.size > 0) {
    await tx.storeVariant.updateMany({
      where: { id: { in: [...reactivateIds] } },
      data: { status: "ACTIVE", retiredAt: null },
    });
  }
  await applyFoundationSellerQuantitySets(tx, args);
}
