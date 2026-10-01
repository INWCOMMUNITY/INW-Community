import type { Prisma, PrismaClient } from "@prisma/client";
import {
  applyTrackedMarketplaceQuantityEdit,
  ETSY_SOURCE_SYSTEM,
  MARKETPLACE_QUANTITY_EDIT_SCOPE,
} from "../commerce-foundation-inventory";
import { classifyShopifyDirectInventoryEdit } from "../shopify/inventory-direct-edit";
import {
  ensureEtsyProjectInventoryJob,
  markEtsyInventoryProjectionApplied,
} from "./inventory-desire";

export type EtsyInventoryInboundDb = PrismaClient | Prisma.TransactionClient;

export type ApplyEtsyInventoryObservationResult =
  | { status: "APPLIED_EDIT"; created: boolean; onHandAfter: number }
  | { status: "ECHO_CONFIRMED" }
  | { status: "SALE_EXPLAINED" }
  | { status: "WAITING_ORDER"; code: "WAITING_ORDER_CAUSALITY" }
  | { status: "IGNORED"; reason: string };

/**
 * Apply a re-read Etsy offering quantity into Foundation after causal sale/echo checks.
 * Etsy offering.quantity is sellable available (≈ onHand - reserved).
 * Never LWW outside MARKETPLACE_QUANTITY_EDIT.
 */
export async function applyEtsyOfferingInventoryObservation(
  db: EtsyInventoryInboundDb,
  input: {
    connectionId: string;
    memberId: string;
    listingLinkId: string;
    etsyListingId: string;
    etsyOfferingId: string;
    remoteAvailable: number;
    /** True when unprocessed paid-order evidence may still explain the delta. */
    hasPendingOrderEvidence?: boolean;
    now?: Date;
  }
): Promise<ApplyEtsyInventoryObservationResult> {
  const remote = input.remoteAvailable;
  if (!Number.isInteger(remote) || remote < 0) {
    return { status: "IGNORED", reason: "INVALID_REMOTE_AVAILABLE" };
  }

  const variantMap = await db.etsyVariantMap.findFirst({
    where: {
      etsyConnectionId: input.connectionId,
      etsyListingLinkId: input.listingLinkId,
      etsyOfferingId: input.etsyOfferingId,
      memberId: input.memberId,
    },
  });
  if (!variantMap) {
    return { status: "IGNORED", reason: "UNMAPPED_OFFERING" };
  }

  if (
    variantMap.inventoryDesiredAvailable != null &&
    remote === variantMap.inventoryDesiredAvailable
  ) {
    if (
      variantMap.inventoryDesiredVersion > 0 &&
      variantMap.inventoryAppliedVersion < variantMap.inventoryDesiredVersion
    ) {
      await markEtsyInventoryProjectionApplied(db, {
        variantMapId: variantMap.id,
        desiredVersion: variantMap.inventoryDesiredVersion,
        available: remote,
        now: input.now,
      });
    }
    return { status: "ECHO_CONFIRMED" };
  }

  if (input.hasPendingOrderEvidence) {
    return { status: "WAITING_ORDER", code: "WAITING_ORDER_CAUSALITY" };
  }

  let explainedSaleDelta: number | null = null;
  if (variantMap.inventoryAppliedAvailable != null) {
    const since = variantMap.inventoryAppliedAt ?? undefined;
    const saleFacts = await db.etsyOrderLineSaleFact.findMany({
      where: {
        etsyConnectionId: input.connectionId,
        storeVariantId: variantMap.storeVariantId,
        applyState: "APPLIED",
        ...(since ? { appliedAt: { gt: since } } : {}),
      },
      select: { appliedQuantity: true, paidQuantity: true },
    });
    if (saleFacts.length > 0) {
      const sold = saleFacts.reduce(
        (sum, row) => sum + (row.appliedQuantity > 0 ? row.appliedQuantity : row.paidQuantity),
        0
      );
      if (sold > 0) explainedSaleDelta = -sold;
    }
  }

  const cls = classifyShopifyDirectInventoryEdit({
    remoteAvailable: remote,
    desiredAvailable: variantMap.inventoryDesiredAvailable,
    appliedAvailable: variantMap.inventoryAppliedAvailable,
    explainedDelta: explainedSaleDelta,
  });

  if (cls === "MATCHES_DESIRED" || cls === "MATCHES_APPLIED_BASE" || cls === "NO_CHANGE") {
    // Remote still at applied base while INW desire is ahead — re-queue outbound so cron pushes qty.
    if (
      cls === "MATCHES_APPLIED_BASE" &&
      variantMap.inventoryDesiredAvailable != null &&
      variantMap.inventoryDesiredAvailable !== remote &&
      variantMap.inventoryDesiredVersion > variantMap.inventoryAppliedVersion
    ) {
      await ensureEtsyProjectInventoryJob(db, {
        connectionId: input.connectionId,
        storeItemId: variantMap.storeItemId,
        storeVariantId: variantMap.storeVariantId,
        inventoryDesiredVersion: variantMap.inventoryDesiredVersion,
      }).catch(() => undefined);
    }
    return { status: "ECHO_CONFIRMED" };
  }
  if (cls === "EXPLAINED_BY_SALE") {
    await markEtsyInventoryProjectionApplied(db, {
      variantMapId: variantMap.id,
      desiredVersion: Math.max(variantMap.inventoryDesiredVersion, 1),
      available: remote,
      now: input.now,
    });
    return { status: "SALE_EXPLAINED" };
  }
  if (cls !== "UNEXPLAINED_REMOTE_EDIT") {
    return { status: "IGNORED", reason: cls };
  }

  const state = await db.inventoryState.findUnique({
    where: { variantId: variantMap.storeVariantId },
    select: { onHand: true, reserved: true, mode: true },
  });
  if (!state || state.mode !== "TRACKED_FINITE" || state.onHand == null) {
    return { status: "IGNORED", reason: "FOUNDATION_STATE_MISSING" };
  }

  const reserved = state.reserved ?? 0;
  const targetOnHand = remote + reserved;
  const base =
    variantMap.inventoryAppliedAvailable != null
      ? String(variantMap.inventoryAppliedAvailable)
      : "null";
  const sourceFactId = `etsy-offering-qty:${input.etsyListingId}:${input.etsyOfferingId}:q${remote}:from${base}`;

  try {
    const applied = await applyTrackedMarketplaceQuantityEdit(db, {
      variantId: variantMap.storeVariantId,
      memberId: input.memberId,
      targetOnHand,
      sourceSystem: ETSY_SOURCE_SYSTEM,
      sourceScope: `${MARKETPLACE_QUANTITY_EDIT_SCOPE}:${input.connectionId}`,
      sourceFactId,
      metadata: {
        etsyListingId: input.etsyListingId,
        etsyOfferingId: input.etsyOfferingId,
        observedAvailable: remote,
      },
    });

    if (applied.status === "SKIPPED") {
      return { status: "ECHO_CONFIRMED" };
    }

    // MQE may bump desire + enqueue PROJECT_INVENTORY. Re-read so we never roll
    // inventoryDesiredVersion backward, then mark this observation applied.
    const mapAfter = await db.etsyVariantMap.findUniqueOrThrow({
      where: { id: variantMap.id },
    });
    const desireVersion = Math.max(mapAfter.inventoryDesiredVersion, 1);
    await db.etsyVariantMap.update({
      where: { id: variantMap.id },
      data: {
        inventoryDesiredAvailable: remote,
        inventoryDesiredVersion: desireVersion,
        inventoryAppliedAvailable: remote,
        inventoryAppliedVersion: desireVersion,
        inventoryAppliedAt: input.now ?? new Date(),
        inventoryDesiredAt: mapAfter.inventoryDesiredAt ?? input.now ?? new Date(),
      },
    });

    return {
      status: "APPLIED_EDIT",
      created: applied.created,
      onHandAfter: applied.onHandAfter,
    };
  } catch {
    return { status: "IGNORED", reason: "MARKETPLACE_QTY_EDIT_FAILED" };
  }
}

/**
 * Apply inventory observations for every mapped offering on a listing poll.
 */
export async function applyEtsyListingInventoryInbound(
  db: EtsyInventoryInboundDb,
  input: {
    connectionId: string;
    memberId: string;
    listingLinkId: string;
    etsyListingId: string;
    variants: Array<{ etsyOfferingId: string; quantity: number | null }>;
    now?: Date;
  }
): Promise<{ applied: number; waitingOrder: number }> {
  const pendingSales = await db.etsyOrderLineSaleFact.count({
    where: {
      etsyConnectionId: input.connectionId,
      applyState: "PENDING",
      etsyListingId: input.etsyListingId,
    },
  });
  const hasPendingOrderEvidence = pendingSales > 0;

  let applied = 0;
  let waitingOrder = 0;
  for (const variant of input.variants) {
    if (variant.quantity == null) continue;
    const result = await applyEtsyOfferingInventoryObservation(db, {
      connectionId: input.connectionId,
      memberId: input.memberId,
      listingLinkId: input.listingLinkId,
      etsyListingId: input.etsyListingId,
      etsyOfferingId: variant.etsyOfferingId,
      remoteAvailable: variant.quantity,
      hasPendingOrderEvidence,
      now: input.now,
    });
    if (result.status === "APPLIED_EDIT") applied += 1;
    if (result.status === "WAITING_ORDER") waitingOrder += 1;
  }
  return { applied, waitingOrder };
}

export type { Prisma };
