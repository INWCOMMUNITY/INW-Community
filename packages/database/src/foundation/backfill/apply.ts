import type { Prisma, PrismaClient } from "@prisma/client";
import { analyzeStoreItem, type LegacyStoreItem } from "./analyze";
import {
  BackfillItemError,
  emptyReport,
  openingFactId,
  OPENING_CAUSE,
  OPENING_SOURCE_SCOPE,
  OPENING_SOURCE_SYSTEM,
  type BackfillRunReport,
  type ItemBackfillPlan,
} from "./types";

type AppliedItem = {
  status: "created" | "verified";
  plan: ItemBackfillPlan;
  variantIds: string[];
  openingsCreated: number;
};

type Tx = Prisma.TransactionClient;

function asLegacy(item: {
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
}): LegacyStoreItem {
  return { ...item, variants: item.variants };
}

function recordFailure(report: BackfillRunReport, err: BackfillItemError): void {
  const failure = { storeItemId: err.storeItemId, code: err.code, message: err.message };
  report.itemsFailed += 1;
  report.failures.push(failure);
  if (err.code === "AMBIGUOUS_FINGERPRINT") report.ambiguousFingerprints.push(failure);
  else if (err.code === "INVALID_MATRIX") report.invalidMatrix.push(failure);
  else if (
    err.code === "INCONSISTENT_MAP_MISSING_VARIANT" ||
    err.code === "INCONSISTENT_VARIANT_OWNERSHIP" ||
    err.code === "INCONSISTENT_EXISTING"
  ) {
    report.inconsistentExisting.push(failure);
  }
}

async function verifyExisting(
  tx: Tx,
  plan: ItemBackfillPlan
): Promise<{ variantIds: string[] }> {
  const maps = await tx.variantBackfillMap.findMany({
    where: { storeItemId: plan.storeItemId },
  });
  const variants = await tx.storeVariant.findMany({
    where: { storeItemId: plan.storeItemId },
  });
  const expected = new Set(plan.variants.map((v) => v.fingerprint));
  const mapped = new Set(maps.map((m) => m.sourceFingerprint));

  if (maps.length === 0 && variants.length > 0) {
    throw new BackfillItemError(
      plan.storeItemId,
      "INCONSISTENT_EXISTING",
      "StoreItem already has Variants but no VariantBackfillMap rows"
    );
  }
  if (maps.length === 0) {
    return { variantIds: [] };
  }

  if (mapped.size !== expected.size || [...expected].some((fp) => !mapped.has(fp))) {
    throw new BackfillItemError(
      plan.storeItemId,
      "INCONSISTENT_EXISTING",
      "Existing backfill fingerprints do not match current legacy representation"
    );
  }

  const variantIds: string[] = [];
  const defaultFp = plan.variants.find((v) => v.isDefault)?.fingerprint;
  for (const planned of plan.variants) {
    const map = maps.find((m) => m.sourceFingerprint === planned.fingerprint);
    if (!map) {
      throw new BackfillItemError(plan.storeItemId, "INCONSISTENT_EXISTING", `Missing map ${planned.fingerprint}`);
    }
    const variant = await tx.storeVariant.findUnique({ where: { id: map.variantId } });
    if (!variant) {
      throw new BackfillItemError(
        plan.storeItemId,
        "INCONSISTENT_MAP_MISSING_VARIANT",
        `VariantBackfillMap ${planned.fingerprint} points to missing Variant ${map.variantId}`
      );
    }
    if (variant.storeItemId !== plan.storeItemId || variant.memberId !== plan.memberId) {
      throw new BackfillItemError(
        plan.storeItemId,
        "INCONSISTENT_VARIANT_OWNERSHIP",
        `Variant ${variant.id} does not belong to StoreItem ${plan.storeItemId}`
      );
    }
    if (variant.isDefault !== (planned.fingerprint === defaultFp)) {
      throw new BackfillItemError(
        plan.storeItemId,
        "INCONSISTENT_EXISTING",
        `Default Variant invariant broken for ${planned.fingerprint}`
      );
    }
    const state = await tx.inventoryState.findUnique({ where: { variantId: variant.id } });
    if (!state) {
      throw new BackfillItemError(
        plan.storeItemId,
        "INCONSISTENT_EXISTING",
        `InventoryState missing for mapped Variant ${variant.id}`
      );
    }
    if (state.mode !== plan.mode || state.storeItemId !== plan.storeItemId || state.memberId !== plan.memberId) {
      throw new BackfillItemError(
        plan.storeItemId,
        "INCONSISTENT_EXISTING",
        `InventoryState mode/tenant mismatch for Variant ${variant.id}`
      );
    }
    const opening = await tx.inventoryEvent.findFirst({
      where: {
        variantId: variant.id,
        eventType: "OPENING_BALANCE",
        sourceSystem: OPENING_SOURCE_SYSTEM,
        sourceScope: OPENING_SOURCE_SCOPE,
        sourceFactId: openingFactId(variant.id),
      },
    });
    if (plan.mode === "TRACKED_FINITE") {
      if (!opening) {
        throw new BackfillItemError(
          plan.storeItemId,
          "INCONSISTENT_EXISTING",
          `OPENING_BALANCE missing for Variant ${variant.id}`
        );
      }
    } else if (opening) {
      throw new BackfillItemError(
        plan.storeItemId,
        "INCONSISTENT_EXISTING",
        `MADE_TO_ORDER Variant ${variant.id} has an unexpected OPENING_BALANCE`
      );
    }
    variantIds.push(variant.id);
  }
  return { variantIds };
}

async function createBackfill(tx: Tx, plan: ItemBackfillPlan): Promise<{ variantIds: string[]; openings: number }> {
  const variantIds: string[] = [];
  let openings = 0;
  for (const planned of plan.variants) {
    const variant = await tx.storeVariant.create({
      data: {
        memberId: plan.memberId,
        storeItemId: plan.storeItemId,
        status: plan.variantStatus,
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
    await tx.variantBackfillMap.create({
      data: {
        storeItemId: plan.storeItemId,
        memberId: plan.memberId,
        sourceFingerprint: planned.fingerprint,
        variantId: variant.id,
      },
    });
    await tx.inventoryState.create({
      data: {
        variantId: variant.id,
        memberId: plan.memberId,
        storeItemId: plan.storeItemId,
        mode: plan.mode,
        onHand: plan.mode === "TRACKED_FINITE" ? planned.openingQty : null,
        reserved: plan.mode === "TRACKED_FINITE" ? 0 : null,
        availabilityVersion: 1,
      },
    });
    if (plan.mode === "TRACKED_FINITE") {
      const qty = planned.openingQty ?? 0;
      await tx.inventoryEvent.create({
        data: {
          memberId: plan.memberId,
          variantId: variant.id,
          storeItemId: plan.storeItemId,
          eventType: "OPENING_BALANCE",
          cause: OPENING_CAUSE,
          sourceSystem: OPENING_SOURCE_SYSTEM,
          sourceScope: OPENING_SOURCE_SCOPE,
          sourceFactId: openingFactId(variant.id),
          requestedQty: qty,
          appliedOnHandQty: qty,
          appliedReservedQty: 0,
          onHandBefore: null,
          onHandAfter: qty,
          reservedBefore: null,
          reservedAfter: 0,
          metadata: { fingerprint: planned.fingerprint },
        },
      });
      openings += 1;
    }
    variantIds.push(variant.id);
  }
  return { variantIds, openings };
}

async function backfillOneItem(tx: Tx, storeItemId: string): Promise<AppliedItem> {
  const item = await tx.storeItem.findUnique({ where: { id: storeItemId } });
  if (!item) {
    throw new BackfillItemError(storeItemId, "INCONSISTENT_EXISTING", "StoreItem not found");
  }
  const plan = analyzeStoreItem(asLegacy(item));
  const existing = await verifyExisting(tx, plan);
  if (existing.variantIds.length > 0) {
    return { status: "verified", plan, variantIds: existing.variantIds, openingsCreated: 0 };
  }
  const created = await createBackfill(tx, plan);
  return { status: "created", plan, variantIds: created.variantIds, openingsCreated: created.openings };
}

export async function runFoundationBackfill(
  prisma: PrismaClient,
  opts: { storeItemIds: string[] }
): Promise<BackfillRunReport> {
  const report = emptyReport();
  report.itemsScanned = opts.storeItemIds.length;
  report.itemsEligible = opts.storeItemIds.length;

  for (const storeItemId of opts.storeItemIds) {
    try {
      const outcome = await prisma.$transaction(async (tx) => backfillOneItem(tx, storeItemId));
      if (outcome.status === "verified") {
        report.itemsVerified += 1;
      } else {
        report.itemsBackfilled += 1;
        report.openingBalancesCreated += outcome.openingsCreated;
        if (outcome.plan.kind === "simple") {
          report.simpleVariantsCreated += outcome.plan.variants.length;
        } else {
          report.matrixVariantsCreated += outcome.plan.variants.length;
        }
        if (outcome.plan.mode === "MADE_TO_ORDER") {
          report.mtoVariants += outcome.plan.variants.length;
        }
      }
      if (outcome.plan.quantityDiverges && outcome.plan.matrixQuantitySum != null) {
        report.quantityDivergences.push({
          storeItemId,
          parentQuantity: outcome.plan.parentQuantity,
          matrixSum: outcome.plan.matrixQuantitySum,
        });
      }
      for (const sku of outcome.plan.duplicateSkus) {
        report.duplicateSkus.push({
          storeItemId,
          sku,
          fingerprints: outcome.plan.variants
            .filter((v) => v.sku?.toLowerCase() === sku)
            .map((v) => v.fingerprint),
        });
      }
    } catch (err) {
      if (err instanceof BackfillItemError) {
        recordFailure(report, err);
        continue;
      }
      throw err;
    }
  }
  return report;
}
