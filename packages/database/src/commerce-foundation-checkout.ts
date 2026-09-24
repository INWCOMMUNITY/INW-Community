import { createHash } from "node:crypto";
import { Prisma, type CheckoutAttempt, type CheckoutAttemptState, type PrismaClient } from "@prisma/client";
import { matrixFingerprint } from "./foundation/backfill/analyze";
import {
  convertReservation,
  FoundationInventoryError,
  FoundationMissingStateError,
  FoundationReservationError,
  holdTrackedReservation,
  lockCheckoutAttemptForUpdate,
  lockCutoverShare,
  lockStoreItemForUpdate,
  releaseReservation,
} from "./commerce-foundation-inventory";
import { resolveCheckoutVariant } from "./commerce-foundation-variant-resolution";

const CHECKOUT_HOLD_MS = 25 * 60 * 1000;
const REUSABLE_ATTEMPT_STATES: CheckoutAttemptState[] = ["CREATED", "SESSION_OPEN", "SESSION_UNKNOWN"];
const CHECKOUT_PREPARE_LOCK_NAMESPACE = "inw.commerce.checkout.prepare.v1";

/** Same numeric cap as apps/main `MTO_PURCHASE_CAP`. Not a new policy. */
export const FOUNDATION_MTO_PURCHASE_CAP = 99;

export type FoundationCheckoutLineInput = {
  storeItemId: string;
  quantity: number;
  priceCentsAtPurchase: number;
  variantJson?: unknown;
  variantId?: string | null;
  fulfillmentType?: string | null;
  pickupDetails?: Prisma.InputJsonValue | null;
};

export type FoundationCheckoutSellerOrderInput = {
  sellerId: string;
  subtotalCents: number;
  shippingCostCents: number;
  totalCents: number;
  shippingAddress?: Prisma.InputJsonValue | null;
  localDeliveryDetails?: Prisma.InputJsonValue | null;
  lines: FoundationCheckoutLineInput[];
};

export type PrepareFoundationCheckoutInput = {
  buyerMemberId: string;
  amountCents: number;
  currency?: string;
  orders: FoundationCheckoutSellerOrderInput[];
};

export type PrepareFoundationCheckoutResult = {
  attemptId: string;
  orderIds: string[];
  expiresAt: Date;
  stripeIdempotencyKey: string;
  reused: boolean;
  state: CheckoutAttemptState;
  stripeCheckoutSessionId: string | null;
};

export type HashFoundationCartExtras = {
  amountCents?: number;
  currency?: string;
};

export class FoundationCheckoutReuseError extends FoundationInventoryError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "FoundationCheckoutReuseError";
  }
}

export class FoundationCheckoutNotConvertibleError extends FoundationReservationError {
  constructor(message: string) {
    super("reservation_not_convertible", message);
    this.name = "FoundationCheckoutNotConvertibleError";
  }
}

function jsonOrNull(
  value: FoundationCheckoutLineInput["pickupDetails"] | FoundationCheckoutSellerOrderInput["shippingAddress"]
) {
  if (value == null) return undefined;
  return value;
}

function asOptionRecord(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const options: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v != null && typeof v === "object" && !Array.isArray(v)) continue;
    const name = String(k ?? "").trim();
    const val = v != null ? String(v).trim() : "";
    if (name && val) options[name] = val;
  }
  return Object.keys(options).length > 0 ? options : null;
}

function canonicalFulfillmentType(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "ship";
}

function locationField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return value == null ? "" : String(value).trim().toLowerCase();
}

function canonicalLocationKey(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const rec = value as Record<string, unknown>;
  const nested =
    rec.deliveryAddress && typeof rec.deliveryAddress === "object" && !Array.isArray(rec.deliveryAddress)
      ? (rec.deliveryAddress as Record<string, unknown>)
      : rec;
  return ["street", "aptorsuite", "city", "state", "zip"]
    .map((field) => {
      const camel = field === "aptorsuite" ? "aptOrSuite" : field;
      return `${field}=${locationField(nested, camel) || locationField(rec, camel)}`;
    })
    .join("|");
}

function canonicalDestinationKey(order: FoundationCheckoutSellerOrderInput): string {
  if (order.localDeliveryDetails) {
    return `ld:${canonicalLocationKey(order.localDeliveryDetails)}`;
  }
  if (order.shippingAddress) {
    return `ship:${canonicalLocationKey(order.shippingAddress)}`;
  }
  return "none";
}

/** Canonical Variant identity for checkout hashing. Prefers resolved variantId; else matrix fingerprint. */
export function canonicalCheckoutVariantIdentity(line: {
  variantId?: string | null;
  variantJson?: unknown;
}): string {
  const variantId = line.variantId?.trim();
  if (variantId) return `id:${variantId}`;
  const options = asOptionRecord(line.variantJson);
  if (options) return `fp:${matrixFingerprint(options)}`;
  return "simple:default";
}

export function hashFoundationCart(
  orders: FoundationCheckoutSellerOrderInput[],
  extras?: HashFoundationCartExtras
): string {
  const parts: string[] = [];
  for (const order of orders) {
    const destination = canonicalDestinationKey(order);
    for (const line of order.lines) {
      parts.push(
        [
          order.sellerId,
          line.storeItemId,
          canonicalCheckoutVariantIdentity(line),
          String(line.quantity),
          canonicalFulfillmentType(line.fulfillmentType),
          String(line.priceCentsAtPurchase),
          String(order.shippingCostCents),
          String(order.totalCents),
          destination,
        ].join(":")
      );
    }
  }
  parts.sort();
  const suffix = `amount=${extras?.amountCents ?? ""}:currency=${extras?.currency ?? "usd"}`;
  return createHash("sha256").update(`${parts.join("|")}|${suffix}`).digest("hex");
}

export function checkoutPrepareAdvisoryLockKeys(
  buyerMemberId: string,
  cartHash: string
): { classId: number; objectId: number } {
  const digest = createHash("sha256")
    .update(CHECKOUT_PREPARE_LOCK_NAMESPACE)
    .update("\0")
    .update(buyerMemberId)
    .update("\0")
    .update(cartHash)
    .digest();
  return {
    classId: digest.readInt32BE(0),
    objectId: digest.readInt32BE(4),
  };
}

async function lockCheckoutPrepareAdvisory(
  tx: Prisma.TransactionClient,
  buyerMemberId: string,
  cartHash: string
): Promise<void> {
  const { classId, objectId } = checkoutPrepareAdvisoryLockKeys(buyerMemberId, cartHash);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${classId}::int, ${objectId}::int)`;
}

async function resolveOrdersForCheckoutHash(
  prisma: PrismaClient,
  orders: FoundationCheckoutSellerOrderInput[]
): Promise<FoundationCheckoutSellerOrderInput[]> {
  const resolved: FoundationCheckoutSellerOrderInput[] = [];
  for (const order of orders) {
    const lines: FoundationCheckoutLineInput[] = [];
    for (const line of order.lines) {
      const variant = await resolveCheckoutVariant(prisma, line.storeItemId, {
        variantId: line.variantId,
        optionJson: line.variantJson,
      });
      lines.push({ ...line, variantId: variant.id });
    }
    resolved.push({ ...order, lines });
  }
  return resolved;
}

export function newCheckoutIdempotencyKey(buyerMemberId: string, cartHash: string, generation = 0): string {
  const base = `nwc_ca_${buyerMemberId}_${cartHash.slice(0, 16)}`;
  return generation <= 0 ? base : `${base}_g${generation}`;
}

export function stripeCheckoutRequestOptions(attempt: { stripeIdempotencyKey: string }): {
  idempotencyKey: string;
} {
  return { idempotencyKey: attempt.stripeIdempotencyKey };
}

function isReusableState(state: CheckoutAttemptState): boolean {
  return REUSABLE_ATTEMPT_STATES.includes(state);
}

async function returnExistingAttempt(
  tx: Prisma.TransactionClient,
  attempt: CheckoutAttempt
): Promise<PrepareFoundationCheckoutResult> {
  // SESSION_UNKNOWN without a persisted Session id is still the same logical attempt:
  // callers must retry Stripe create with the same idempotency key (never mint _gN).
  const orders = await tx.storeOrder.findMany({
    where: { checkoutAttemptId: attempt.id },
    select: { id: true },
  });
  return {
    attemptId: attempt.id,
    orderIds: orders.map((o) => o.id),
    expiresAt: attempt.expiresAt ?? new Date(Date.now() + CHECKOUT_HOLD_MS),
    stripeIdempotencyKey: attempt.stripeIdempotencyKey,
    reused: true,
    state: attempt.state,
    stripeCheckoutSessionId: attempt.stripeCheckoutSessionId,
  };
}

async function findReusableAttempt(
  tx: Prisma.TransactionClient,
  buyerMemberId: string,
  cartHash: string
): Promise<CheckoutAttempt | null> {
  return tx.checkoutAttempt.findFirst({
    where: {
      buyerMemberId,
      cartHash,
      state: { in: REUSABLE_ATTEMPT_STATES },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function prepareFoundationCheckout(
  prisma: PrismaClient,
  input: PrepareFoundationCheckoutInput
): Promise<PrepareFoundationCheckoutResult> {
  const resolvedOrders = await resolveOrdersForCheckoutHash(prisma, input.orders);
  const cartHash = hashFoundationCart(resolvedOrders, {
    amountCents: input.amountCents,
    currency: input.currency ?? "usd",
  });
  const expiresAt = new Date(Date.now() + CHECKOUT_HOLD_MS);

  return prisma.$transaction(async (tx) => {
    await lockCutoverShare(tx);
    await lockCheckoutPrepareAdvisory(tx, input.buyerMemberId, cartHash);

    const existing = await findReusableAttempt(tx, input.buyerMemberId, cartHash);
    if (existing) {
      await lockCheckoutAttemptForUpdate(tx, existing.id);
      const locked = await tx.checkoutAttempt.findUnique({ where: { id: existing.id } });
      if (locked && isReusableState(locked.state)) {
        return returnExistingAttempt(tx, locked);
      }
    }

    const storeItemIds = [
      ...new Set(resolvedOrders.flatMap((order) => order.lines.map((line) => line.storeItemId))),
    ].sort();
    for (const storeItemId of storeItemIds) {
      await lockStoreItemForUpdate(tx, storeItemId);
    }

    const stillOpen = await findReusableAttempt(tx, input.buyerMemberId, cartHash);
    if (stillOpen) {
      await lockCheckoutAttemptForUpdate(tx, stillOpen.id);
      const locked = await tx.checkoutAttempt.findUnique({ where: { id: stillOpen.id } });
      if (locked && isReusableState(locked.state)) {
        return returnExistingAttempt(tx, locked);
      }
    }

    const priorCount = await tx.checkoutAttempt.count({
      where: { buyerMemberId: input.buyerMemberId, cartHash },
    });
    const stripeIdempotencyKey = newCheckoutIdempotencyKey(input.buyerMemberId, cartHash, priorCount);

    const attempt = await tx.checkoutAttempt.create({
      data: {
        buyerMemberId: input.buyerMemberId,
        state: "CREATED",
        cartHash,
        amountCents: input.amountCents,
        currency: input.currency ?? "usd",
        stripeIdempotencyKey,
        expiresAt,
      },
    });

    const orderIds: string[] = [];
    for (const sellerOrder of resolvedOrders) {
      const order = await tx.storeOrder.create({
        data: {
          buyerId: input.buyerMemberId,
          sellerId: sellerOrder.sellerId,
          subtotalCents: sellerOrder.subtotalCents,
          shippingCostCents: sellerOrder.shippingCostCents,
          totalCents: sellerOrder.totalCents,
          status: "pending",
          checkoutAttemptId: attempt.id,
          commerceStatus: "PENDING",
          shippingAddress: jsonOrNull(sellerOrder.shippingAddress) as Prisma.InputJsonValue | undefined,
          localDeliveryDetails: jsonOrNull(sellerOrder.localDeliveryDetails) as Prisma.InputJsonValue | undefined,
        },
      });
      orderIds.push(order.id);

      for (const line of sellerOrder.lines) {
        const variant = await resolveCheckoutVariant(
          tx,
          line.storeItemId,
          { variantId: line.variantId, optionJson: line.variantJson },
          { requireActive: true }
        );
        const state = await tx.inventoryState.findUnique({ where: { variantId: variant.id } });
        if (!state) {
          throw new FoundationMissingStateError(`InventoryState missing for Variant ${variant.id}`);
        }
        if (state.mode === "MADE_TO_ORDER" && line.quantity > FOUNDATION_MTO_PURCHASE_CAP) {
          throw new FoundationInventoryError(
            "mto_purchase_cap",
            `Made-to-order quantity cannot exceed ${FOUNDATION_MTO_PURCHASE_CAP}`
          );
        }
        const orderItem = await tx.orderItem.create({
          data: {
            orderId: order.id,
            storeItemId: line.storeItemId,
            quantity: line.quantity,
            priceCentsAtPurchase: line.priceCentsAtPurchase,
            variant: line.variantJson == null ? undefined : (line.variantJson as Prisma.InputJsonValue),
            variantId: variant.id,
            fulfillmentType: line.fulfillmentType ?? null,
            pickupDetails: jsonOrNull(line.pickupDetails) as Prisma.InputJsonValue | undefined,
          },
        });
        if (state.mode === "TRACKED_FINITE") {
          await holdTrackedReservation(tx, {
            checkoutAttemptId: attempt.id,
            storeOrderId: order.id,
            orderItemId: orderItem.id,
            variantId: variant.id,
            qty: line.quantity,
            expiresAt,
          });
        }
      }
    }

    return {
      attemptId: attempt.id,
      orderIds,
      expiresAt,
      stripeIdempotencyKey,
      reused: false,
      state: "CREATED" as const,
      stripeCheckoutSessionId: null,
    };
  });
}

export async function markCheckoutAttemptSessionOpen(
  prisma: PrismaClient,
  args: { attemptId: string; stripeCheckoutSessionId: string; stripePaymentIntentId?: string | null }
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockCutoverShare(tx);
    await lockCheckoutAttemptForUpdate(tx, args.attemptId);
    const attempt = await tx.checkoutAttempt.findUnique({ where: { id: args.attemptId } });
    if (!attempt) {
      throw new FoundationMissingStateError("CheckoutAttempt not found while persisting Stripe Session");
    }
    if (attempt.paymentStatus === "PAID" || attempt.state === "PAID" || attempt.state === "CLOSED") {
      return;
    }
    if (
      attempt.stripeCheckoutSessionId &&
      attempt.stripeCheckoutSessionId !== args.stripeCheckoutSessionId
    ) {
      throw new FoundationCheckoutReuseError(
        "checkout_session_conflict",
        `CheckoutAttempt ${args.attemptId} already has a different Stripe Checkout Session`
      );
    }
    await tx.checkoutAttempt.update({
      where: { id: args.attemptId },
      data: {
        state: "SESSION_OPEN",
        stripeCheckoutSessionId: args.stripeCheckoutSessionId,
        ...(args.stripePaymentIntentId ? { stripePaymentIntentId: args.stripePaymentIntentId } : {}),
      },
    });
    await tx.storeOrder.updateMany({
      where: { checkoutAttemptId: args.attemptId },
      data: { stripeCheckoutSessionId: args.stripeCheckoutSessionId },
    });
  });
}

export async function failCheckoutAttemptAndRelease(
  prisma: PrismaClient,
  attemptId: string,
  reason = "STRIPE_SESSION_FAILED",
  opts?: { attemptState?: "SESSION_FAILED" | "CLOSED"; cancelReason?: string }
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockCutoverShare(tx);
    await lockCheckoutAttemptForUpdate(tx, attemptId);
    const attempt = await tx.checkoutAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) return;
    if (attempt.paymentStatus === "PAID" || attempt.state === "PAID") {
      return;
    }
    // Never release holds while a provider session may still be payable / unknown.
    if (attempt.state === "SESSION_UNKNOWN") return;
    if (attempt.state === "SESSION_OPEN" && attempt.stripeCheckoutSessionId) return;
    const reservations = await tx.inventoryReservation.findMany({
      where: { checkoutAttemptId: attemptId, activeQty: { gt: 0 } },
    });
    for (const reservation of reservations) {
      await releaseReservation(tx, { reservationId: reservation.id, reason });
    }
    await tx.checkoutAttempt.update({
      where: { id: attemptId },
      data: { state: opts?.attemptState ?? "SESSION_FAILED" },
    });
    await tx.storeOrder.updateMany({
      where: { checkoutAttemptId: attemptId, status: "pending" },
      data: {
        status: "canceled",
        cancelReason: opts?.cancelReason ?? "Stripe checkout session failed",
      },
    });
  });
}

export async function markCheckoutAttemptSessionUnknown(
  prisma: PrismaClient,
  args: { attemptId: string; stripeCheckoutSessionId?: string | null; stripePaymentIntentId?: string | null }
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockCutoverShare(tx);
    await lockCheckoutAttemptForUpdate(tx, args.attemptId);
    const attempt = await tx.checkoutAttempt.findUnique({ where: { id: args.attemptId } });
    if (!attempt) return;
    if (
      attempt.paymentStatus === "PAID" ||
      attempt.state === "PAID" ||
      attempt.state === "CLOSED" ||
      attempt.state === "SESSION_FAILED"
    ) {
      return;
    }
    if (
      attempt.stripeCheckoutSessionId &&
      args.stripeCheckoutSessionId &&
      attempt.stripeCheckoutSessionId !== args.stripeCheckoutSessionId
    ) {
      throw new FoundationCheckoutReuseError(
        "checkout_session_conflict",
        `CheckoutAttempt ${args.attemptId} already has a different Stripe Checkout Session`
      );
    }
    await tx.checkoutAttempt.update({
      where: { id: args.attemptId },
      data: {
        state: "SESSION_UNKNOWN",
        ...(args.stripeCheckoutSessionId ? { stripeCheckoutSessionId: args.stripeCheckoutSessionId } : {}),
        ...(args.stripePaymentIntentId ? { stripePaymentIntentId: args.stripePaymentIntentId } : {}),
      },
    });
    if (args.stripeCheckoutSessionId) {
      await tx.storeOrder.updateMany({
        where: { checkoutAttemptId: args.attemptId },
        data: { stripeCheckoutSessionId: args.stripeCheckoutSessionId },
      });
    }
  });
}

/** Matches Stripe transfer classifier: prior create may have succeeded under this key. */
const SESSION_IDEMPOTENCY_MISMATCH_RE =
  /keys for idempotent requests|idempotent requests can only be used with the same parameters|idempotency(?: key)?(?: parameter)? mismatch|idempotency_key_in_use/i;

/**
 * Provider-call classifier for Checkout Session create.
 * "failed" only when evidence shows Stripe did not create a session.
 * Idempotency mismatch / timeouts / 5xx → "unknown" (do not release holds).
 */
export function classifyStripeSessionCreateFailure(err: unknown): "failed" | "unknown" {
  const e = err as { type?: string; statusCode?: number; code?: string; message?: string };
  const msg = `${typeof e?.message === "string" ? e.message : String(err ?? "")} ${e?.code ?? ""}`;
  if (e?.type === "StripeIdempotencyError" || SESSION_IDEMPOTENCY_MISMATCH_RE.test(msg)) return "unknown";
  if (e?.type === "StripeConnectionError") return "unknown";
  if (e?.type === "StripeRateLimitError") return "unknown";
  if (e?.type === "StripeAuthenticationError") return "unknown";
  if (e?.type === "StripeAPIError") return "unknown";
  const status = e?.statusCode;
  if (status === 0 || (status == null && /timeout|ECONNRESET|ETIMEDOUT|network|socket/i.test(msg))) {
    return "unknown";
  }
  if (typeof status === "number" && status >= 500) return "unknown";
  if (status === 429) return "unknown";
  if (/timeout|ECONNRESET|ETIMEDOUT|network|socket/i.test(msg)) return "unknown";
  return "failed";
}

async function findAttemptForPayment(
  tx: Prisma.TransactionClient,
  args: {
    attemptId?: string | null;
    stripeCheckoutSessionId?: string | null;
    stripePaymentIntentId?: string | null;
  }
): Promise<CheckoutAttempt | null> {
  if (args.attemptId) {
    return tx.checkoutAttempt.findUnique({ where: { id: args.attemptId } });
  }
  if (args.stripeCheckoutSessionId) {
    return tx.checkoutAttempt.findUnique({
      where: { stripeCheckoutSessionId: args.stripeCheckoutSessionId },
    });
  }
  if (args.stripePaymentIntentId) {
    return tx.checkoutAttempt.findUnique({
      where: { stripePaymentIntentId: args.stripePaymentIntentId },
    });
  }
  return null;
}

async function persistFoundationPaymentTruth(
  prisma: PrismaClient,
  args: {
    attemptId?: string | null;
    stripeCheckoutSessionId?: string | null;
    stripePaymentIntentId?: string | null;
    stripeEventId?: string | null;
    eventType?: string | null;
    payload?: Prisma.InputJsonValue;
  }
): Promise<{ attemptId: string }> {
  return prisma.$transaction(async (tx) => {
    await lockCutoverShare(tx);
    let attempt = await findAttemptForPayment(tx, args);
    if (!attempt) {
      throw new FoundationMissingStateError("CheckoutAttempt not found for foundation payment finalization");
    }
    await lockCheckoutAttemptForUpdate(tx, attempt.id);
    attempt = await tx.checkoutAttempt.findUnique({ where: { id: attempt.id } });
    if (!attempt) {
      throw new FoundationMissingStateError("CheckoutAttempt not found for foundation payment finalization");
    }

    if (
      attempt.stripeCheckoutSessionId &&
      args.stripeCheckoutSessionId &&
      attempt.stripeCheckoutSessionId !== args.stripeCheckoutSessionId
    ) {
      throw new FoundationCheckoutReuseError(
        "checkout_session_conflict",
        `CheckoutAttempt ${attempt.id} already has a different Stripe Checkout Session`
      );
    }

    if (args.stripeEventId) {
      await tx.stripeEventEvidence.upsert({
        where: { stripeEventId: args.stripeEventId },
        create: {
          stripeEventId: args.stripeEventId,
          eventType: args.eventType ?? "unknown",
          stripeCreatedAt: new Date(),
          payload: args.payload ?? {},
          processState: "RECEIVED",
          checkoutAttemptId: attempt.id,
        },
        update: { checkoutAttemptId: attempt.id },
      });
    }

    await tx.checkoutAttempt.update({
      where: { id: attempt.id },
      data: {
        paymentStatus: "PAID",
        ...(args.stripeCheckoutSessionId ? { stripeCheckoutSessionId: args.stripeCheckoutSessionId } : {}),
        ...(args.stripePaymentIntentId ? { stripePaymentIntentId: args.stripePaymentIntentId } : {}),
      },
    });
    return { attemptId: attempt.id };
  });
}

async function finalizeFoundationCommerceAfterPaid(
  prisma: PrismaClient,
  attemptId: string
): Promise<{ attemptId: string; converted: number; alreadyFinalized: boolean }> {
  return prisma.$transaction(async (tx) => {
    await lockCutoverShare(tx);
    await lockCheckoutAttemptForUpdate(tx, attemptId);
    const attempt = await tx.checkoutAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) {
      throw new FoundationMissingStateError("CheckoutAttempt not found for foundation payment finalization");
    }
    if (attempt.paymentStatus !== "PAID") {
      throw new FoundationMissingStateError("CheckoutAttempt is not PAID; commerce finalization refused");
    }

    const orders = await tx.storeOrder.findMany({
      where: { checkoutAttemptId: attempt.id },
      include: { items: true },
    });
    const alreadyFinalized = orders.length > 0 && orders.every((o) => o.commerceStatus === "FINALIZED");
    if (alreadyFinalized) {
      return { attemptId: attempt.id, converted: 0, alreadyFinalized: true };
    }

    const reservations = await tx.inventoryReservation.findMany({
      where: { checkoutAttemptId: attempt.id },
    });
    const reservationByLine = new Map(reservations.map((row) => [row.orderItemId, row]));
    let converted = 0;

    for (const order of orders) {
      for (const line of order.items) {
        if (!line.variantId) {
          throw new FoundationCheckoutNotConvertibleError(
            `OrderItem ${line.id} is missing variantId for paid finalization`
          );
        }
        const state = await tx.inventoryState.findUnique({ where: { variantId: line.variantId } });
        if (!state) {
          throw new FoundationMissingStateError(`InventoryState missing for Variant ${line.variantId}`);
        }
        if (state.mode === "MADE_TO_ORDER") continue;
        const reservation = reservationByLine.get(line.id);
        if (!reservation) {
          throw new FoundationCheckoutNotConvertibleError(
            `Tracked OrderItem ${line.id} has no reservation to convert`
          );
        }
        const result = await convertReservation(tx, { reservationId: reservation.id });
        if (result.outcome !== "converted" && result.outcome !== "already_converted") {
          throw new FoundationCheckoutNotConvertibleError(
            `Reservation ${reservation.id} cannot be converted (outcome=${result.outcome})`
          );
        }
        if (result.converted) converted += 1;
      }
    }

    await tx.checkoutAttempt.update({
      where: { id: attempt.id },
      data: { state: "PAID" },
    });
    await tx.storeOrder.updateMany({
      where: { checkoutAttemptId: attempt.id },
      data: { commerceStatus: "FINALIZED" },
    });
    return { attemptId: attempt.id, converted, alreadyFinalized: false };
  });
}

export async function finalizeFoundationCheckoutPayment(
  prisma: PrismaClient,
  args: {
    attemptId?: string | null;
    stripeCheckoutSessionId?: string | null;
    stripePaymentIntentId?: string | null;
    stripeEventId?: string | null;
    eventType?: string | null;
    payload?: Prisma.InputJsonValue;
  }
): Promise<{ attemptId: string; converted: number; alreadyFinalized: boolean }> {
  const paid = await persistFoundationPaymentTruth(prisma, args);
  return finalizeFoundationCommerceAfterPaid(prisma, paid.attemptId);
}

export type FoundationAttemptExpiryDecision = "finalize" | "release_and_cancel" | "hold";

export function foundationAttemptExpiryDecision(attempt: {
  state: CheckoutAttempt["state"];
  paymentStatus: CheckoutAttempt["paymentStatus"];
}): FoundationAttemptExpiryDecision {
  if (attempt.paymentStatus === "PAID" || attempt.state === "PAID") return "finalize";
  if (attempt.state === "SESSION_UNKNOWN") return "hold";
  return "release_and_cancel";
}

export async function expireFoundationCheckoutAttempt(
  prisma: PrismaClient,
  attemptId: string
): Promise<FoundationAttemptExpiryDecision> {
  return prisma.$transaction(async (tx) => {
    await lockCutoverShare(tx);
    const locked = await lockCheckoutAttemptForUpdate(tx, attemptId);
    if (!locked) return "hold";
    const attempt = await tx.checkoutAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) return "hold";
    const decision = foundationAttemptExpiryDecision(attempt);
    if (decision !== "release_and_cancel") {
      return decision;
    }
    const reservations = await tx.inventoryReservation.findMany({
      where: { checkoutAttemptId: attemptId, activeQty: { gt: 0 } },
    });
    for (const reservation of reservations) {
      await releaseReservation(tx, { reservationId: reservation.id, reason: "EXPIRE" });
    }
    await tx.checkoutAttempt.update({
      where: { id: attemptId },
      data: { state: "CLOSED" },
    });
    await tx.storeOrder.updateMany({
      where: { checkoutAttemptId: attemptId, status: "pending" },
      data: {
        status: "canceled",
        cancelReason: "Checkout expired",
      },
    });
    return decision;
  });
}
