import type { CheckoutAttempt, CheckoutAttemptState, Prisma, PrismaClient } from "@prisma/client";
import { lockCheckoutAttemptForUpdate, lockCutoverShare, releaseReservation } from "./commerce-foundation-inventory";

export const FOUNDATION_CHECKOUT_RECONCILIATION_BATCH_SIZE = 20;
export const FOUNDATION_CHECKOUT_HOLD_MS = 25 * 60 * 1000;

export type FoundationCheckoutReconciliationClassification =
  | "ACTIVE"
  | "EXPIRED_RELEASED"
  | "PAID_NEEDS_FULFILLMENT"
  | "PAID_FINALIZED"
  | "PAID_NOT_CONVERTIBLE"
  | "PAYMENT_PENDING"
  | "UNKNOWN_PROVIDER_OUTCOME"
  | "NEEDS_OPERATOR"
  | "ALREADY_FINALIZED"
  | "NO_ACTION"
  | "REQUIRES_REVIEW";

export type FoundationCheckoutProviderObservation =
  | {
      kind: "session";
      stripeCheckoutSessionId: string;
      stripeStatus: string;
      paymentStatus: string;
      url: string | null;
      paymentIntentId: string | null;
    }
  | { kind: "missing_session_id" }
  | { kind: "provider_not_found"; stripeCheckoutSessionId: string };

export type FoundationCheckoutObservationResult = {
  classification: FoundationCheckoutReconciliationClassification;
  attemptId: string;
  state: CheckoutAttemptState | null;
  paymentStatus: CheckoutAttempt["paymentStatus"] | null;
  stripeCheckoutSessionId: string | null;
  checkoutUrl: string | null;
  retryable: boolean;
};

export function foundationCheckoutReconciliationCronAllowed(mode: string | null | undefined): boolean {
  return mode === "FOUNDATION" || mode === "UNFROZEN";
}

export function hostedCheckoutUrlIfActive(observation: {
  stripeStatus: string;
  url: string | null;
}): string | null {
  if (observation.stripeStatus !== "open") return null;
  const url = observation.url?.trim();
  return url ? url : null;
}

function emptyResult(
  attemptId: string,
  classification: FoundationCheckoutReconciliationClassification,
  extras?: Partial<FoundationCheckoutObservationResult>
): FoundationCheckoutObservationResult {
  const retryable =
    classification === "UNKNOWN_PROVIDER_OUTCOME" || classification === "PAYMENT_PENDING";
  return {
    classification,
    attemptId,
    state: extras?.state ?? null,
    paymentStatus: extras?.paymentStatus ?? null,
    stripeCheckoutSessionId: extras?.stripeCheckoutSessionId ?? null,
    checkoutUrl: extras?.checkoutUrl ?? null,
    retryable: extras?.retryable ?? retryable,
  };
}

async function touchReconciledAt(tx: Prisma.TransactionClient, attemptId: string, at: Date): Promise<void> {
  await tx.checkoutAttempt.update({
    where: { id: attemptId },
    data: { reconciledAt: at },
  });
}

async function releaseActiveHoldsAndCloseUnpaid(
  tx: Prisma.TransactionClient,
  attemptId: string
): Promise<void> {
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
}

function isTerminalUnpaid(attempt: CheckoutAttempt): boolean {
  return (
    attempt.paymentStatus !== "PAID" &&
    (attempt.state === "CLOSED" || attempt.state === "SESSION_FAILED")
  );
}

async function paidClassification(
  tx: Prisma.TransactionClient,
  attempt: CheckoutAttempt
): Promise<FoundationCheckoutReconciliationClassification> {
  const orders = await tx.storeOrder.findMany({
    where: { checkoutAttemptId: attempt.id },
    select: { commerceStatus: true },
  });
  const commerceFinalized = orders.length > 0 && orders.every((order) => order.commerceStatus === "FINALIZED");
  if (attempt.state === "PAID" || commerceFinalized) return "ALREADY_FINALIZED";
  const reservations = await tx.inventoryReservation.findMany({
    where: { checkoutAttemptId: attempt.id },
    select: { activeQty: true, releasedQty: true, convertedQty: true },
  });
  const releasedUnconverted = reservations.some(
    (row) => row.releasedQty > 0 && row.convertedQty === 0 && row.activeQty === 0
  );
  if (releasedUnconverted || attempt.state === "CLOSED") return "PAID_NOT_CONVERTIBLE";
  return "PAID_NEEDS_FULFILLMENT";
}

/**
 * Apply a Stripe observation that was retrieved OUTSIDE this transaction.
 * Caller must lock nothing across the provider round-trip.
 */
export async function applyFoundationCheckoutProviderObservation(
  prisma: PrismaClient,
  attemptId: string,
  observation: FoundationCheckoutProviderObservation,
  now = new Date()
): Promise<FoundationCheckoutObservationResult> {
  return prisma.$transaction(async (tx) => {
    await lockCutoverShare(tx);
    const locked = await lockCheckoutAttemptForUpdate(tx, attemptId);
    if (!locked) {
      return emptyResult(attemptId, "NO_ACTION");
    }
    let attempt = await tx.checkoutAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) {
      return emptyResult(attemptId, "NO_ACTION");
    }

    await touchReconciledAt(tx, attemptId, now);
    attempt = (await tx.checkoutAttempt.findUnique({ where: { id: attemptId } })) ?? attempt;

    if (attempt.paymentStatus === "PAID") {
      const classification = await paidClassification(tx, attempt);
      return emptyResult(attemptId, classification, {
        state: attempt.state,
        paymentStatus: attempt.paymentStatus,
        stripeCheckoutSessionId: attempt.stripeCheckoutSessionId,
        retryable: classification === "PAID_NEEDS_FULFILLMENT",
      });
    }

    if (observation.kind === "missing_session_id") {
      return emptyResult(attemptId, "NEEDS_OPERATOR", {
        state: attempt.state,
        paymentStatus: attempt.paymentStatus,
        stripeCheckoutSessionId: null,
        retryable: false,
      });
    }

    if (observation.kind === "provider_not_found") {
      return emptyResult(attemptId, "NEEDS_OPERATOR", {
        state: attempt.state,
        paymentStatus: attempt.paymentStatus,
        stripeCheckoutSessionId: attempt.stripeCheckoutSessionId,
        retryable: false,
      });
    }

    if (isTerminalUnpaid(attempt) && !(observation.stripeStatus === "expired" && observation.paymentStatus === "unpaid")) {
      return emptyResult(attemptId, "NO_ACTION", {
        state: attempt.state,
        paymentStatus: attempt.paymentStatus,
        stripeCheckoutSessionId: attempt.stripeCheckoutSessionId,
        retryable: false,
      });
    }

    const sessionId = observation.stripeCheckoutSessionId;
    const paymentIntentId = observation.paymentIntentId;

    if (observation.paymentStatus === "no_payment_required") {
      return emptyResult(attemptId, "REQUIRES_REVIEW", {
        state: attempt.state,
        paymentStatus: attempt.paymentStatus,
        stripeCheckoutSessionId: sessionId,
        retryable: false,
      });
    }

    if (observation.stripeStatus === "open") {
      if (isTerminalUnpaid(attempt)) {
        return emptyResult(attemptId, "NO_ACTION", {
          state: attempt.state,
          paymentStatus: attempt.paymentStatus,
          stripeCheckoutSessionId: attempt.stripeCheckoutSessionId,
          retryable: false,
        });
      }
      await tx.checkoutAttempt.update({
        where: { id: attemptId },
        data: {
          state: "SESSION_OPEN",
          stripeCheckoutSessionId: sessionId,
          ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
        },
      });
      await tx.storeOrder.updateMany({
        where: { checkoutAttemptId: attemptId },
        data: { stripeCheckoutSessionId: sessionId },
      });
      return emptyResult(attemptId, "ACTIVE", {
        state: "SESSION_OPEN",
        paymentStatus: attempt.paymentStatus,
        stripeCheckoutSessionId: sessionId,
        checkoutUrl: hostedCheckoutUrlIfActive(observation),
        retryable: false,
      });
    }

    if (observation.stripeStatus === "expired" && observation.paymentStatus === "unpaid") {
      await releaseActiveHoldsAndCloseUnpaid(tx, attemptId);
      const closed = await tx.checkoutAttempt.findUnique({ where: { id: attemptId } });
      return emptyResult(attemptId, "EXPIRED_RELEASED", {
        state: closed?.state ?? "CLOSED",
        paymentStatus: closed?.paymentStatus ?? attempt.paymentStatus,
        stripeCheckoutSessionId: closed?.stripeCheckoutSessionId ?? sessionId,
        retryable: true,
      });
    }

    if (observation.paymentStatus === "paid") {
      await tx.checkoutAttempt.update({
        where: { id: attemptId },
        data: {
          paymentStatus: "PAID",
          stripeCheckoutSessionId: sessionId,
          ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
        },
      });
      const paid = await tx.checkoutAttempt.findUnique({ where: { id: attemptId } });
      const classification = paid ? await paidClassification(tx, paid) : "PAID_NEEDS_FULFILLMENT";
      return emptyResult(attemptId, classification === "ALREADY_FINALIZED" ? "PAID_FINALIZED" : classification, {
        state: paid?.state ?? attempt.state,
        paymentStatus: "PAID",
        stripeCheckoutSessionId: sessionId,
        retryable: classification === "PAID_NEEDS_FULFILLMENT",
      });
    }

    if (observation.stripeStatus === "complete" && observation.paymentStatus === "unpaid") {
      if (paymentIntentId && !attempt.stripePaymentIntentId) {
        await tx.checkoutAttempt.update({
          where: { id: attemptId },
          data: { stripePaymentIntentId: paymentIntentId },
        });
      }
      return emptyResult(attemptId, "PAYMENT_PENDING", {
        state: attempt.state,
        paymentStatus: attempt.paymentStatus,
        stripeCheckoutSessionId: attempt.stripeCheckoutSessionId ?? sessionId,
        retryable: true,
      });
    }

    return emptyResult(attemptId, "UNKNOWN_PROVIDER_OUTCOME", {
      state: attempt.state,
      paymentStatus: attempt.paymentStatus,
      stripeCheckoutSessionId: attempt.stripeCheckoutSessionId ?? sessionId,
      retryable: true,
    });
  });
}

export async function listFoundationCheckoutReconciliationCandidates(
  prisma: PrismaClient,
  args?: { take?: number; now?: Date }
): Promise<Array<{ id: string; state: CheckoutAttemptState; stripeCheckoutSessionId: string | null }>> {
  const now = args?.now ?? new Date();
  const take = args?.take ?? FOUNDATION_CHECKOUT_RECONCILIATION_BATCH_SIZE;
  const staleBefore = new Date(now.getTime() - FOUNDATION_CHECKOUT_HOLD_MS);
  return prisma.checkoutAttempt.findMany({
    where: {
      AND: [
        { state: { notIn: ["SESSION_FAILED"] } },
        {
          OR: [
            { state: "SESSION_UNKNOWN" },
            {
              state: "SESSION_OPEN",
              OR: [{ expiresAt: { lte: now } }, { expiresAt: null, createdAt: { lte: staleBefore } }, { createdAt: { lte: staleBefore } }],
            },
            {
              paymentStatus: "PAID",
              state: { in: ["CREATED", "SESSION_OPEN", "SESSION_UNKNOWN"] },
            },
            {
              paymentStatus: "PAID",
              state: "PAID",
              storeOrders: { some: { commerceStatus: { not: "FINALIZED" } } },
            },
          ],
        },
      ],
    },
    select: { id: true, state: true, stripeCheckoutSessionId: true },
    orderBy: { createdAt: "asc" },
    take,
  });
}
