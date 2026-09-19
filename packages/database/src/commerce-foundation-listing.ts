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
  const variants = await tx.storeVariant.findMany({ where: { storeItemId: args.storeItemId } });
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
  const variants = await tx.storeVariant.findMany({ where: { storeItemId } });
  assertNoStructuralVariantChange(
    variants.map((variant) => optionFingerprintOf(variant.options)),
    nextFingerprints
  );
}

export async function markFoundationListingSold(
  tx: FoundationDb,
  args: { storeItemId: string; memberId: string; commandId: string }
): Promise<void> {
  await lockCutoverShare(tx);
  await lockStoreItemForUpdate(tx, args.storeItemId);
  const variants = await tx.storeVariant.findMany({ where: { storeItemId: args.storeItemId } });
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
  await tx.storeVariant.updateMany({
    where: { storeItemId: args.storeItemId },
    data: { status: "ACTIVE", retiredAt: null },
  });
  await applyFoundationSellerQuantitySets(tx, args);
}
