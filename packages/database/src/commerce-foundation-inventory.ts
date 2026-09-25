import type { InventoryEventType, InventoryMode, Prisma, PrismaClient } from "@prisma/client";
import {
  COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID,
  assertFoundationInventoryWriterAllowed,
} from "./commerce-foundation-cutover";
import type { FoundationDb } from "./commerce-foundation-variant-resolution";

export const FOUNDATION_SOURCE_SYSTEM = "inw";
export const SHOPIFY_SOURCE_SYSTEM = "shopify";
export const NATIVE_OPENING_SCOPE = "commerce-foundation-native";
export const CHECKOUT_SCOPE = "checkout";
export const PAYMENT_SCOPE = "payment";
export const SELLER_SCOPE = "seller";
export const RESTOCK_SCOPE = "restock";
export const EXPIRE_SCOPE = "expire";
export const MARKETPLACE_ORDER_CAUSE = "MARKETPLACE_ORDER";

export class FoundationInventoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FoundationInventoryError";
    this.code = code;
  }
}

export class FoundationMissingStateError extends FoundationInventoryError {
  constructor(message: string) {
    super("foundation_state_missing", message);
    this.name = "FoundationMissingStateError";
  }
}

export class FoundationInsufficientAvailabilityError extends FoundationInventoryError {
  constructor(message: string) {
    super("insufficient_availability", message);
    this.name = "FoundationInsufficientAvailabilityError";
  }
}

export class FoundationReservationError extends FoundationInventoryError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "FoundationReservationError";
  }
}

export class FoundationRestockReviewError extends FoundationInventoryError {
  constructor(message: string) {
    super("restock_needs_review", message);
    this.name = "FoundationRestockReviewError";
  }
}

type LockedInventoryState = {
  variantId: string;
  memberId: string;
  storeItemId: string;
  mode: InventoryMode;
  onHand: number | null;
  reserved: number | null;
  availabilityVersion: number;
};

function isUniqueConflict(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002";
}

export function trackedAvailable(onHand: number, reserved: number): number {
  if (onHand < 0 || reserved < 0 || reserved > onHand) {
    throw new FoundationInventoryError("invalid_inventory_invariants", "onHand/reserved invariants violated");
  }
  return onHand - reserved;
}

export async function lockCutoverShare(tx: FoundationDb): Promise<void> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "commerce_foundation_cutover" WHERE id = ${COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID} FOR SHARE
  `;
  if (locked.length === 0) {
    throw new FoundationMissingStateError("Commerce foundation cutover singleton is missing");
  }
  await assertFoundationInventoryWriterAllowed(tx);
}

export async function lockStoreItemForUpdate(tx: FoundationDb, storeItemId: string): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM "StoreItem" WHERE "id" = ${storeItemId} FOR UPDATE`;
}

export async function lockCheckoutAttemptForUpdate(
  tx: FoundationDb,
  attemptId: string
): Promise<{ id: string } | null> {
  await tx.$executeRaw`SELECT 1 FROM "checkout_attempt" WHERE "id" = ${attemptId} FOR UPDATE`;
  return tx.checkoutAttempt.findUnique({ where: { id: attemptId }, select: { id: true } });
}

export async function lockInventoryState(
  tx: FoundationDb,
  variantId: string
): Promise<LockedInventoryState> {
  await tx.$executeRaw`SELECT 1 FROM "inventory_state" WHERE "variant_id" = ${variantId} FOR UPDATE`;
  const state = await tx.inventoryState.findUnique({ where: { variantId } });
  if (!state) {
    throw new FoundationMissingStateError(`InventoryState missing for Variant ${variantId}`);
  }
  return state;
}

export async function lockReservation(tx: FoundationDb, reservationId: string) {
  await tx.$executeRaw`SELECT 1 FROM "inventory_reservation" WHERE "id" = ${reservationId} FOR UPDATE`;
  const row = await tx.inventoryReservation.findUnique({ where: { id: reservationId } });
  if (!row) {
    throw new FoundationReservationError("reservation_missing", `Reservation ${reservationId} not found`);
  }
  return row;
}

async function findCausalEvent(
  tx: FoundationDb,
  args: {
    memberId: string;
    sourceSystem: string;
    sourceScope: string;
    eventType: InventoryEventType;
    sourceFactId: string;
  }
) {
  return tx.inventoryEvent.findFirst({
    where: {
      memberId: args.memberId,
      sourceSystem: args.sourceSystem,
      sourceScope: args.sourceScope,
      eventType: args.eventType,
      sourceFactId: args.sourceFactId,
    },
  });
}

type EventInput = {
  memberId: string;
  variantId: string;
  storeItemId: string;
  eventType: InventoryEventType;
  cause: string;
  sourceSystem: string;
  sourceScope: string;
  sourceFactId: string;
  requestedQty?: number;
  appliedOnHandQty?: number;
  appliedReservedQty?: number;
  onHandBefore?: number | null;
  onHandAfter?: number | null;
  reservedBefore?: number | null;
  reservedAfter?: number | null;
  targetOnHand?: number | null;
  commandId?: string | null;
  reservationId?: string | null;
  orderItemId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export async function appendInventoryEvent(
  tx: FoundationDb,
  input: EventInput
): Promise<{ id: string; created: boolean }> {
  const existing = await findCausalEvent(tx, input);
  if (existing) return { id: existing.id, created: false };
  try {
    const created = await tx.inventoryEvent.create({
      data: {
        memberId: input.memberId,
        variantId: input.variantId,
        storeItemId: input.storeItemId,
        eventType: input.eventType,
        cause: input.cause,
        sourceSystem: input.sourceSystem,
        sourceScope: input.sourceScope,
        sourceFactId: input.sourceFactId,
        requestedQty: input.requestedQty ?? 0,
        appliedOnHandQty: input.appliedOnHandQty ?? 0,
        appliedReservedQty: input.appliedReservedQty ?? 0,
        onHandBefore: input.onHandBefore ?? null,
        onHandAfter: input.onHandAfter ?? null,
        reservedBefore: input.reservedBefore ?? null,
        reservedAfter: input.reservedAfter ?? null,
        targetOnHand: input.targetOnHand ?? null,
        commandId: input.commandId ?? null,
        reservationId: input.reservationId ?? null,
        orderItemId: input.orderItemId ?? null,
        metadata: input.metadata,
      },
    });
    return { id: created.id, created: true };
  } catch (err) {
    if (isUniqueConflict(err)) {
      const again = await findCausalEvent(tx, input);
      if (again) return { id: again.id, created: false };
    }
    throw err;
  }
}

export async function projectStoreItemQuantity(tx: FoundationDb, storeItemId: string): Promise<number> {
  await lockStoreItemForUpdate(tx, storeItemId);
  const item = await tx.storeItem.findUnique({
    where: { id: storeItemId },
    select: { id: true, inventoryTracking: true },
  });
  if (!item) {
    throw new FoundationMissingStateError(`StoreItem ${storeItemId} not found for projection`);
  }
  if (item.inventoryTracking === "made_to_order") {
    await tx.storeItem.update({ where: { id: storeItemId }, data: { quantity: 0 } });
    return 0;
  }
  const states = await tx.inventoryState.findMany({ where: { storeItemId } });
  let sum = 0;
  for (const state of states) {
    if (state.mode === "MADE_TO_ORDER") continue;
    if (state.onHand == null || state.reserved == null) {
      throw new FoundationMissingStateError(`TRACKED InventoryState incomplete for ${state.variantId}`);
    }
    sum += Math.max(0, trackedAvailable(state.onHand, state.reserved));
  }
  await tx.storeItem.update({ where: { id: storeItemId }, data: { quantity: sum } });
  return sum;
}

export async function sumTrackedOnHand(tx: FoundationDb, storeItemId: string): Promise<number> {
  const states = await tx.inventoryState.findMany({ where: { storeItemId } });
  let sum = 0;
  for (const state of states) {
    if (state.mode !== "TRACKED_FINITE") continue;
    sum += state.onHand ?? 0;
  }
  return sum;
}

export async function maybeMarkSoldOutIfPhysicallyGone(tx: FoundationDb, storeItemId: string): Promise<void> {
  const item = await tx.storeItem.findUnique({
    where: { id: storeItemId },
    select: { id: true, status: true, inventoryTracking: true },
  });
  if (!item || item.inventoryTracking === "made_to_order") return;
  if (item.status !== "active") return;
  const onHand = await sumTrackedOnHand(tx, storeItemId);
  if (onHand === 0) {
    await tx.storeItem.update({ where: { id: storeItemId }, data: { status: "sold_out" } });
  }
}

export async function maybeReactivateAfterRestock(tx: FoundationDb, storeItemId: string): Promise<void> {
  const item = await tx.storeItem.findUnique({
    where: { id: storeItemId },
    select: { id: true, status: true, endedAt: true, inventoryTracking: true },
  });
  if (!item || item.inventoryTracking === "made_to_order") return;
  if (item.status !== "sold_out") return;
  const onHand = await sumTrackedOnHand(tx, storeItemId);
  if (onHand > 0) {
    await tx.storeItem.update({ where: { id: storeItemId }, data: { status: "active" } });
  }
}

async function bumpVersionAndWrite(
  tx: FoundationDb,
  state: LockedInventoryState,
  next: { onHand: number | null; reserved: number | null }
): Promise<number> {
  const nextVersion = state.availabilityVersion + 1;
  await tx.inventoryState.update({
    where: { variantId: state.variantId },
    data: {
      onHand: next.onHand,
      reserved: next.reserved,
      availabilityVersion: nextVersion,
    },
  });
  return nextVersion;
}

export async function setTrackedOnHand(
  tx: FoundationDb,
  args: {
    variantId: string;
    targetOnHand: number;
    commandId: string;
    cause?: string;
    memberId?: string;
  }
): Promise<{ changed: boolean; onHand: number; reserved: number; quantity: number }> {
  await lockCutoverShare(tx);
  if (!Number.isInteger(args.targetOnHand) || args.targetOnHand < 0) {
    throw new FoundationInventoryError("invalid_set_target", "SET target must be an integer >= 0");
  }
  const variant = await tx.storeVariant.findUnique({ where: { id: args.variantId } });
  if (!variant) {
    throw new FoundationMissingStateError(`StoreVariant ${args.variantId} not found`);
  }
  await lockStoreItemForUpdate(tx, variant.storeItemId);
  const state = await lockInventoryState(tx, args.variantId);
  if (args.memberId && state.memberId !== args.memberId) {
    throw new FoundationInventoryError("variant_ownership", "Variant does not belong to this member");
  }
  if (state.mode !== "TRACKED_FINITE" || state.onHand == null || state.reserved == null) {
    throw new FoundationInventoryError("mto_set_forbidden", "SET is not valid for MADE_TO_ORDER inventory");
  }
  if (args.targetOnHand < state.reserved) {
    throw new FoundationInventoryError(
      "set_below_reserved",
      `Cannot SET onHand ${args.targetOnHand} below reserved ${state.reserved}`
    );
  }
  const sourceFactId = `set:${args.variantId}:${args.commandId}`;
  if (args.targetOnHand === state.onHand) {
    const quantity = await projectStoreItemQuantity(tx, state.storeItemId);
    return { changed: false, onHand: state.onHand, reserved: state.reserved, quantity };
  }
  const applied = Math.abs(args.targetOnHand - state.onHand);
  const event = await appendInventoryEvent(tx, {
    memberId: state.memberId,
    variantId: state.variantId,
    storeItemId: state.storeItemId,
    eventType: "SET",
    cause: args.cause ?? "SELLER",
    sourceSystem: FOUNDATION_SOURCE_SYSTEM,
    sourceScope: SELLER_SCOPE,
    sourceFactId,
    requestedQty: args.targetOnHand,
    appliedOnHandQty: applied,
    appliedReservedQty: 0,
    onHandBefore: state.onHand,
    onHandAfter: args.targetOnHand,
    reservedBefore: state.reserved,
    reservedAfter: state.reserved,
    targetOnHand: args.targetOnHand,
    commandId: args.commandId,
  });
  if (event.created) {
    await bumpVersionAndWrite(tx, state, { onHand: args.targetOnHand, reserved: state.reserved });
  }
  const quantity = await projectStoreItemQuantity(tx, state.storeItemId);
  return {
    changed: event.created,
    onHand: args.targetOnHand,
    reserved: state.reserved,
    quantity,
  };
}

export async function holdTrackedReservation(
  tx: FoundationDb,
  args: {
    checkoutAttemptId: string;
    storeOrderId: string;
    orderItemId: string;
    variantId: string;
    qty: number;
    expiresAt: Date;
  }
): Promise<{ reservationId: string; created: boolean; available: number }> {
  await lockCutoverShare(tx);
  if (!Number.isInteger(args.qty) || args.qty < 1) {
    throw new FoundationInventoryError("invalid_hold_qty", "HOLD quantity must be an integer >= 1");
  }
  const existingRes = await tx.inventoryReservation.findUnique({ where: { orderItemId: args.orderItemId } });
  if (existingRes) {
    return {
      reservationId: existingRes.id,
      created: false,
      available: 0,
    };
  }
  const variant = await tx.storeVariant.findUnique({ where: { id: args.variantId } });
  if (!variant) {
    throw new FoundationMissingStateError(`StoreVariant ${args.variantId} not found`);
  }
  await lockStoreItemForUpdate(tx, variant.storeItemId);
  const state = await lockInventoryState(tx, args.variantId);
  if (state.mode === "MADE_TO_ORDER") {
    throw new FoundationInventoryError("mto_hold_forbidden", "MTO checkout must not HOLD finite inventory");
  }
  if (state.onHand == null || state.reserved == null) {
    throw new FoundationMissingStateError(`TRACKED InventoryState incomplete for ${args.variantId}`);
  }
  const available = trackedAvailable(state.onHand, state.reserved);
  if (available < args.qty) {
    throw new FoundationInsufficientAvailabilityError(
      `Available ${available} is less than requested ${args.qty}`
    );
  }
  const reservation = await tx.inventoryReservation.create({
    data: {
      memberId: state.memberId,
      checkoutAttemptId: args.checkoutAttemptId,
      storeOrderId: args.storeOrderId,
      orderItemId: args.orderItemId,
      variantId: args.variantId,
      storeItemId: state.storeItemId,
      originalQty: args.qty,
      activeQty: args.qty,
      convertedQty: 0,
      releasedQty: 0,
      invalidatedQty: 0,
      expiresAt: args.expiresAt,
    },
  });
  const sourceFactId = `${args.checkoutAttemptId}:${args.orderItemId}`;
  const event = await appendInventoryEvent(tx, {
    memberId: state.memberId,
    variantId: state.variantId,
    storeItemId: state.storeItemId,
    eventType: "RESERVATION_HOLD",
    cause: "CHECKOUT",
    sourceSystem: FOUNDATION_SOURCE_SYSTEM,
    sourceScope: CHECKOUT_SCOPE,
    sourceFactId,
    requestedQty: args.qty,
    appliedOnHandQty: 0,
    appliedReservedQty: args.qty,
    onHandBefore: state.onHand,
    onHandAfter: state.onHand,
    reservedBefore: state.reserved,
    reservedAfter: state.reserved + args.qty,
    reservationId: reservation.id,
    orderItemId: args.orderItemId,
  });
  if (event.created) {
    await bumpVersionAndWrite(tx, state, { onHand: state.onHand, reserved: state.reserved + args.qty });
  }
  await projectStoreItemQuantity(tx, state.storeItemId);
  return {
    reservationId: reservation.id,
    created: event.created,
    available: available - args.qty,
  };
}

export async function releaseReservation(
  tx: FoundationDb,
  args: { reservationId: string; reason: string }
): Promise<{ released: boolean; activeQty: number }> {
  await lockCutoverShare(tx);
  const peek = await tx.inventoryReservation.findUnique({ where: { id: args.reservationId } });
  if (!peek) {
    throw new FoundationReservationError("reservation_missing", `Reservation ${args.reservationId} not found`);
  }
  await lockStoreItemForUpdate(tx, peek.storeItemId);
  const reservation = await lockReservation(tx, args.reservationId);
  if (reservation.activeQty <= 0) {
    return { released: false, activeQty: 0 };
  }
  const state = await lockInventoryState(tx, reservation.variantId);
  if (state.mode !== "TRACKED_FINITE" || state.onHand == null || state.reserved == null) {
    throw new FoundationMissingStateError(`TRACKED InventoryState incomplete for ${reservation.variantId}`);
  }
  const qty = reservation.activeQty;
  if (state.reserved < qty) {
    throw new FoundationInventoryError("reserved_underflow", "Cannot release more than currently reserved");
  }
  const sourceScope = `${EXPIRE_SCOPE}:${args.reason}`;
  const sourceFactId = `${reservation.checkoutAttemptId}:${reservation.orderItemId}`;
  const event = await appendInventoryEvent(tx, {
    memberId: reservation.memberId,
    variantId: reservation.variantId,
    storeItemId: reservation.storeItemId,
    eventType: "RESERVATION_RELEASE",
    cause: args.reason,
    sourceSystem: FOUNDATION_SOURCE_SYSTEM,
    sourceScope,
    sourceFactId,
    requestedQty: qty,
    appliedOnHandQty: 0,
    appliedReservedQty: qty,
    onHandBefore: state.onHand,
    onHandAfter: state.onHand,
    reservedBefore: state.reserved,
    reservedAfter: state.reserved - qty,
    reservationId: reservation.id,
    orderItemId: reservation.orderItemId,
  });
  if (event.created) {
    await tx.inventoryReservation.update({
      where: { id: reservation.id },
      data: {
        activeQty: 0,
        releasedQty: reservation.releasedQty + qty,
      },
    });
    await bumpVersionAndWrite(tx, state, { onHand: state.onHand, reserved: state.reserved - qty });
    await projectStoreItemQuantity(tx, state.storeItemId);
  }
  return { released: event.created, activeQty: 0 };
}

export type ConvertReservationOutcome =
  | "converted"
  | "already_converted"
  | "released"
  | "invalidated"
  | "missing";

function convertOutcomeWhenInactive(reservation: {
  convertedQty: number;
  releasedQty: number;
  invalidatedQty: number;
}): ConvertReservationOutcome {
  if (reservation.convertedQty > 0 && reservation.releasedQty === 0 && reservation.invalidatedQty === 0) {
    return "already_converted";
  }
  if (reservation.releasedQty > 0) return "released";
  if (reservation.invalidatedQty > 0) return "invalidated";
  return "missing";
}

export async function convertReservation(
  tx: FoundationDb,
  args: { reservationId: string }
): Promise<{ outcome: ConvertReservationOutcome; converted: boolean }> {
  await lockCutoverShare(tx);
  const peek = await tx.inventoryReservation.findUnique({ where: { id: args.reservationId } });
  if (!peek) {
    return { outcome: "missing", converted: false };
  }
  await lockStoreItemForUpdate(tx, peek.storeItemId);
  const reservation = await lockReservation(tx, args.reservationId);
  if (reservation.activeQty <= 0) {
    const outcome = convertOutcomeWhenInactive(reservation);
    return { outcome, converted: false };
  }
  const state = await lockInventoryState(tx, reservation.variantId);
  if (state.mode !== "TRACKED_FINITE" || state.onHand == null || state.reserved == null) {
    throw new FoundationMissingStateError(`TRACKED InventoryState incomplete for ${reservation.variantId}`);
  }
  const qty = reservation.activeQty;
  if (state.reserved < qty || state.onHand < qty) {
    throw new FoundationInventoryError("convert_underflow", "CONVERT would underflow onHand or reserved");
  }
  const sourceFactId = `${reservation.checkoutAttemptId}:${reservation.orderItemId}`;
  const event = await appendInventoryEvent(tx, {
    memberId: reservation.memberId,
    variantId: reservation.variantId,
    storeItemId: reservation.storeItemId,
    eventType: "RESERVATION_CONVERT",
    cause: "INW_ORDER",
    sourceSystem: FOUNDATION_SOURCE_SYSTEM,
    sourceScope: PAYMENT_SCOPE,
    sourceFactId,
    requestedQty: qty,
    appliedOnHandQty: qty,
    appliedReservedQty: qty,
    onHandBefore: state.onHand,
    onHandAfter: state.onHand - qty,
    reservedBefore: state.reserved,
    reservedAfter: state.reserved - qty,
    reservationId: reservation.id,
    orderItemId: reservation.orderItemId,
  });
  if (event.created) {
    await tx.inventoryReservation.update({
      where: { id: reservation.id },
      data: {
        activeQty: 0,
        convertedQty: reservation.convertedQty + qty,
      },
    });
    await bumpVersionAndWrite(tx, state, { onHand: state.onHand - qty, reserved: state.reserved - qty });
    await projectStoreItemQuantity(tx, state.storeItemId);
    await maybeMarkSoldOutIfPhysicallyGone(tx, state.storeItemId);
  }
  return { outcome: event.created ? "converted" : "already_converted", converted: event.created };
}

export async function restockTrackedVariant(
  tx: FoundationDb,
  args: {
    variantId: string;
    qty: number;
    kind: "PHYSICAL_RECEIPT" | "UNDO_CONSUMPTION";
    sourceFactId: string;
    orderItemId?: string | null;
    cause?: string;
  }
): Promise<{ onHand: number; quantity: number }> {
  await lockCutoverShare(tx);
  if (!Number.isInteger(args.qty) || args.qty < 1) {
    throw new FoundationInventoryError("invalid_restock_qty", "Restock quantity must be an integer >= 1");
  }
  const variant = await tx.storeVariant.findUnique({ where: { id: args.variantId } });
  if (!variant) {
    throw new FoundationMissingStateError(`StoreVariant ${args.variantId} not found`);
  }
  await lockStoreItemForUpdate(tx, variant.storeItemId);
  const state = await lockInventoryState(tx, args.variantId);
  if (state.mode !== "TRACKED_FINITE" || state.onHand == null || state.reserved == null) {
    throw new FoundationInventoryError("mto_restock_forbidden", "Restock is not valid for MADE_TO_ORDER");
  }
  const nextOnHand = state.onHand + args.qty;
  const event = await appendInventoryEvent(tx, {
    memberId: state.memberId,
    variantId: state.variantId,
    storeItemId: state.storeItemId,
    eventType: args.kind,
    cause: args.cause ?? (args.kind === "PHYSICAL_RECEIPT" ? "RETURN" : "REFUND"),
    sourceSystem: FOUNDATION_SOURCE_SYSTEM,
    sourceScope: RESTOCK_SCOPE,
    sourceFactId: args.sourceFactId,
    requestedQty: args.qty,
    appliedOnHandQty: args.qty,
    appliedReservedQty: 0,
    onHandBefore: state.onHand,
    onHandAfter: nextOnHand,
    reservedBefore: state.reserved,
    reservedAfter: state.reserved,
    orderItemId: args.orderItemId ?? null,
  });
  if (event.created) {
    await bumpVersionAndWrite(tx, state, { onHand: nextOnHand, reserved: state.reserved });
  }
  const quantity = await projectStoreItemQuantity(tx, state.storeItemId);
  await maybeReactivateAfterRestock(tx, state.storeItemId);
  return { onHand: event.created ? nextOnHand : state.onHand, quantity };
}

/**
 * Causal marketplace SALE for TRACKED_FINITE variants.
 * Decrements onHand by qty without touching reserved (requires available >= qty).
 * MADE_TO_ORDER: no finite onHand change and no fabricated quantity — caller records sale fact only.
 * Idempotent via sourceSystem/sourceScope/eventType/sourceFactId causal key.
 */
export async function applyTrackedMarketplaceSale(
  tx: FoundationDb,
  args: {
    variantId: string;
    memberId: string;
    qty: number;
    /** Generation-bound scope (e.g. ShopifyConnection.id). */
    sourceScope: string;
    /** Durable provider line identity (e.g. orderGid:lineItemGid). */
    sourceFactId: string;
    metadata?: Prisma.InputJsonValue;
  }
): Promise<
  | {
      status: "APPLIED";
      created: boolean;
      mode: "TRACKED_FINITE";
      inventoryEventId: string;
      onHandAfter: number;
    }
  | {
      status: "APPLIED";
      created: boolean;
      mode: "MADE_TO_ORDER";
      inventoryEventId: null;
      onHandAfter: null;
    }
> {
  await lockCutoverShare(tx);
  if (!Number.isInteger(args.qty) || args.qty < 1) {
    throw new FoundationInventoryError("invalid_sale_qty", "SALE quantity must be an integer >= 1");
  }
  if (!args.sourceScope.trim() || !args.sourceFactId.trim()) {
    throw new FoundationInventoryError("invalid_sale_source", "SALE requires sourceScope and sourceFactId");
  }
  const variant = await tx.storeVariant.findUnique({ where: { id: args.variantId } });
  if (!variant) {
    throw new FoundationMissingStateError(`StoreVariant ${args.variantId} not found`);
  }
  if (variant.memberId !== args.memberId) {
    throw new FoundationInventoryError("variant_ownership", "Variant does not belong to this member");
  }
  await lockStoreItemForUpdate(tx, variant.storeItemId);
  const state = await lockInventoryState(tx, args.variantId);
  if (state.memberId !== args.memberId || state.storeItemId !== variant.storeItemId) {
    throw new FoundationInventoryError("variant_ownership", "InventoryState ownership mismatch");
  }

  if (state.mode === "MADE_TO_ORDER") {
    // Match checkout finalize: MTO sales do not invent finite onHand (no 999).
    return {
      status: "APPLIED",
      created: false,
      mode: "MADE_TO_ORDER",
      inventoryEventId: null,
      onHandAfter: null,
    };
  }

  if (state.mode !== "TRACKED_FINITE" || state.onHand == null || state.reserved == null) {
    throw new FoundationMissingStateError(`TRACKED InventoryState incomplete for ${args.variantId}`);
  }
  const available = trackedAvailable(state.onHand, state.reserved);
  if (available < args.qty) {
    throw new FoundationInsufficientAvailabilityError(
      `Available ${available} is less than marketplace SALE ${args.qty}`
    );
  }
  const onHandAfter = state.onHand - args.qty;
  const event = await appendInventoryEvent(tx, {
    memberId: state.memberId,
    variantId: state.variantId,
    storeItemId: state.storeItemId,
    eventType: "SALE",
    cause: MARKETPLACE_ORDER_CAUSE,
    sourceSystem: SHOPIFY_SOURCE_SYSTEM,
    sourceScope: args.sourceScope,
    sourceFactId: args.sourceFactId,
    requestedQty: args.qty,
    appliedOnHandQty: args.qty,
    appliedReservedQty: 0,
    onHandBefore: state.onHand,
    onHandAfter,
    reservedBefore: state.reserved,
    reservedAfter: state.reserved,
    metadata: args.metadata,
  });
  if (event.created) {
    await bumpVersionAndWrite(tx, state, { onHand: onHandAfter, reserved: state.reserved });
    await projectStoreItemQuantity(tx, state.storeItemId);
    await maybeMarkSoldOutIfPhysicallyGone(tx, state.storeItemId);
  }
  return {
    status: "APPLIED",
    created: event.created,
    mode: "TRACKED_FINITE",
    inventoryEventId: event.id,
    onHandAfter: event.created ? onHandAfter : state.onHand,
  };
}

export async function incrementAvailabilityNoopCheck(): Promise<void> {
  // Documented: callers skip bumpVersionAndWrite when appendInventoryEvent returns created=false.
}

export type { PrismaClient };
