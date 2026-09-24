import type { PrismaClient } from "@prisma/client";
import { trackedAvailable } from "./commerce-foundation-inventory";
import { matrixFingerprint } from "./foundation/backfill/analyze";
import { SIMPLE_FINGERPRINT } from "./foundation/backfill/types";

export type QuantityMismatch = {
  storeItemId: string;
  storedQuantity: number;
  expectedQuantity: number;
};

export type FoundationHealthIssue = {
  storeItemId: string;
  code: string;
  message: string;
};

function optionFingerprintOf(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return SIMPLE_FINGERPRINT;
  const options: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const name = String(k ?? "").trim();
    const val = v != null ? String(v).trim() : "";
    if (name && val) options[name] = val;
  }
  return Object.keys(options).length === 0 ? SIMPLE_FINGERPRINT : matrixFingerprint(options);
}

export async function expectedCompatibilityQuantity(
  prisma: PrismaClient,
  storeItemId: string
): Promise<number> {
  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { inventoryTracking: true },
  });
  if (!item) return 0;
  if (item.inventoryTracking === "made_to_order") return 0;
  const states = await prisma.inventoryState.findMany({ where: { storeItemId } });
  let sum = 0;
  for (const state of states) {
    if (state.mode !== "TRACKED_FINITE" || state.onHand == null || state.reserved == null) continue;
    sum += Math.max(0, trackedAvailable(state.onHand, state.reserved));
  }
  return sum;
}

/** Read-only. Does not repair StoreItem.quantity. */
export async function reconcileStoreItemQuantities(
  prisma: PrismaClient,
  storeItemIds: string[]
): Promise<QuantityMismatch[]> {
  const mismatches: QuantityMismatch[] = [];
  for (const storeItemId of storeItemIds) {
    const item = await prisma.storeItem.findUnique({
      where: { id: storeItemId },
      select: { quantity: true },
    });
    if (!item) continue;
    const expected = await expectedCompatibilityQuantity(prisma, storeItemId);
    if (expected !== item.quantity) {
      mismatches.push({ storeItemId, storedQuantity: item.quantity, expectedQuantity: expected });
    }
  }
  return mismatches;
}

/** Internal read-only verifier. Not a public API. */
export async function verifyFoundationListingHealth(
  prisma: PrismaClient,
  storeItemId: string
): Promise<FoundationHealthIssue[]> {
  const issues: FoundationHealthIssue[] = [];
  const item = await prisma.storeItem.findUnique({ where: { id: storeItemId } });
  if (!item) {
    return [{ storeItemId, code: "missing_item", message: "StoreItem not found" }];
  }
  const variants = await prisma.storeVariant.findMany({ where: { storeItemId } });
  if (variants.length === 0) {
    issues.push({ storeItemId, code: "missing_variants", message: "No StoreVariant rows" });
    return issues;
  }
  const defaults = variants.filter((v) => v.isDefault);
  if (defaults.length !== 1) {
    issues.push({
      storeItemId,
      code: "default_variant",
      message: `Expected exactly one default Variant, found ${defaults.length}`,
    });
  }
  for (const variant of variants) {
    if (variant.memberId !== item.memberId || variant.storeItemId !== item.id) {
      issues.push({
        storeItemId,
        code: "ownership",
        message: `Variant ${variant.id} ownership mismatch`,
      });
    }
    const state = await prisma.inventoryState.findUnique({ where: { variantId: variant.id } });
    if (!state) {
      issues.push({
        storeItemId,
        code: "missing_inventory_state",
        message: `InventoryState missing for ${variant.id}`,
      });
      continue;
    }
    if (state.memberId !== item.memberId || state.storeItemId !== item.id) {
      issues.push({
        storeItemId,
        code: "ownership",
        message: `InventoryState ownership mismatch for ${variant.id}`,
      });
    }
    if (state.mode === "TRACKED_FINITE") {
      if (state.onHand == null || state.reserved == null || state.reserved > state.onHand) {
        issues.push({
          storeItemId,
          code: "reservation_conservation",
          message: `Invalid onHand/reserved for ${variant.id}`,
        });
      }
    } else if (state.onHand != null || state.reserved != null) {
      issues.push({
        storeItemId,
        code: "mto_qty",
        message: `MTO Variant ${variant.id} has onHand/reserved values`,
      });
    }
  }

  const maps = await prisma.variantBackfillMap.findMany({ where: { storeItemId } });
  const fps = new Set<string>();
  for (const map of maps) {
    if (fps.has(map.sourceFingerprint)) {
      issues.push({
        storeItemId,
        code: "map_corruption",
        message: `Duplicate fingerprint ${map.sourceFingerprint}`,
      });
    }
    fps.add(map.sourceFingerprint);
    const variant = variants.find((v) => v.id === map.variantId);
    if (!variant) {
      issues.push({
        storeItemId,
        code: "map_corruption",
        message: `Map ${map.sourceFingerprint} points at missing Variant`,
      });
    } else {
      const live = optionFingerprintOf(variant.options);
      if (map.sourceFingerprint !== live && map.sourceFingerprint !== SIMPLE_FINGERPRINT) {
        issues.push({
          storeItemId,
          code: "map_corruption",
          message: `Map ${map.sourceFingerprint} does not match live options ${live}`,
        });
      }
    }
  }

  const expected = await expectedCompatibilityQuantity(prisma, storeItemId);
  if (expected !== item.quantity) {
    issues.push({
      storeItemId,
      code: "quantity_projection",
      message: `quantity ${item.quantity} != expected ${expected}`,
    });
  }
  return issues;
}
