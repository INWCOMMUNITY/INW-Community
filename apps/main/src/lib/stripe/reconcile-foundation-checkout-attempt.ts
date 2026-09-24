import Stripe from "stripe";
import {
  applyFoundationCheckoutProviderObservation,
  foundationCheckoutReconciliationCronAllowed,
  isFoundationBuyerSaleCompleteStatus,
  listFoundationCheckoutReconciliationCandidates,
  foundationSucceededPayoutLocalRepairOutstanding,
  type FoundationCheckoutObservationResult,
  type FoundationCheckoutProviderObservation,
  type FoundationCheckoutReconciliationClassification,
  type PrismaClient,
} from "database";
import { fulfillStoreOrdersFromCheckoutSession } from "@/lib/stripe/fulfill-storefront-orders";

export type StripeCheckoutRetrieveClient = {
  checkout: {
    sessions: {
      retrieve: (id: string) => Promise<Stripe.Checkout.Session>;
    };
  };
};

export type FoundationCheckoutReconciliationResult = FoundationCheckoutObservationResult & {
  retrieveFailure?: "transient" | "not_found";
};

export type ReconcileFoundationCheckoutDeps = {
  prisma: PrismaClient;
  stripe: StripeCheckoutRetrieveClient;
  attemptId: string;
  fulfillPaidSession?: (session: Stripe.Checkout.Session) => Promise<void>;
};

function paymentIntentIdFromSession(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent;
  if (typeof pi === "string" && pi.trim()) return pi;
  if (pi && typeof pi === "object" && "id" in pi && typeof pi.id === "string") return pi.id;
  return null;
}

export function observationFromStripeCheckoutSession(
  session: Stripe.Checkout.Session
): FoundationCheckoutProviderObservation {
  return {
    kind: "session",
    stripeCheckoutSessionId: session.id,
    stripeStatus: session.status ?? "",
    paymentStatus: session.payment_status ?? "",
    url: typeof session.url === "string" ? session.url : null,
    paymentIntentId: paymentIntentIdFromSession(session),
  };
}

export function classifyStripeCheckoutRetrieveFailure(
  err: unknown
): "transient" | "not_found" | "unknown" {
  const e = err as { type?: string; statusCode?: number; code?: string; message?: string };
  if (e?.type === "StripeConnectionError") return "transient";
  if (e?.type === "StripeAPIError" && (e.statusCode ?? 0) >= 500) return "transient";
  const status = e?.statusCode ?? 0;
  if (status >= 500) return "transient";
  const msg = typeof e?.message === "string" ? e.message : String(err ?? "");
  if (/timeout|ECONNRESET|ETIMEDOUT|network|socket/i.test(msg)) return "transient";
  if (e?.code === "resource_missing" || status === 404) return "not_found";
  if (e?.type === "StripeInvalidRequestError" && (status === 404 || /no such checkout session/i.test(msg))) {
    return "not_found";
  }
  return "unknown";
}

export function checkoutReconciliationHttpContract(result: FoundationCheckoutReconciliationResult): {
  status: number;
  body: { error: string; retryable: boolean; classification: FoundationCheckoutReconciliationClassification };
} {
  switch (result.classification) {
    case "EXPIRED_RELEASED":
      return {
        status: 409,
        body: { error: "checkout_session_expired", retryable: true, classification: result.classification },
      };
    case "PAYMENT_PENDING":
      return {
        status: 409,
        body: { error: "checkout_payment_pending", retryable: true, classification: result.classification },
      };
    case "PAID_FINALIZED":
    case "PAID_NEEDS_FULFILLMENT":
    case "ALREADY_FINALIZED":
    case "PAID_NOT_CONVERTIBLE":
      return {
        status: 409,
        body: { error: "checkout_already_paid", retryable: false, classification: result.classification },
      };
    case "NEEDS_OPERATOR":
    case "REQUIRES_REVIEW":
      return {
        status: 409,
        body: { error: "checkout_session_unresolved", retryable: false, classification: result.classification },
      };
    case "UNKNOWN_PROVIDER_OUTCOME":
      return {
        status: 503,
        body: { error: "checkout_session_unknown", retryable: true, classification: result.classification },
      };
    default:
      return {
        status: 503,
        body: { error: "checkout_session_unknown", retryable: true, classification: result.classification },
      };
  }
}

function logReconciliation(
  result: FoundationCheckoutReconciliationResult,
  extras?: Record<string, unknown>
): void {
  console.info("[foundation-checkout-reconcile]", {
    attemptId: result.attemptId,
    classification: result.classification,
    state: result.state,
    stripeCheckoutSessionId: result.stripeCheckoutSessionId,
    retryable: result.retryable,
    retrieveFailure: result.retrieveFailure ?? null,
    ...extras,
  });
}

async function loadAttempt(prisma: PrismaClient, attemptId: string) {
  return prisma.checkoutAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      state: true,
      paymentStatus: true,
      stripeCheckoutSessionId: true,
      stripePaymentIntentId: true,
    },
  });
}

/**
 * Reconcile one CheckoutAttempt against Stripe Checkout Session truth.
 * Provider retrieve happens outside any DB transaction.
 */
export async function reconcileFoundationCheckoutAttempt(
  deps: ReconcileFoundationCheckoutDeps
): Promise<FoundationCheckoutReconciliationResult> {
  const attempt = await loadAttempt(deps.prisma, deps.attemptId);
  if (!attempt) {
    const result: FoundationCheckoutReconciliationResult = {
      classification: "NO_ACTION",
      attemptId: deps.attemptId,
      state: null,
      paymentStatus: null,
      stripeCheckoutSessionId: null,
      checkoutUrl: null,
      retryable: false,
    };
    logReconciliation(result);
    return result;
  }

  if (!attempt.stripeCheckoutSessionId) {
    const result = await applyFoundationCheckoutProviderObservation(deps.prisma, attempt.id, {
      kind: "missing_session_id",
    });
    logReconciliation(result);
    return result;
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await deps.stripe.checkout.sessions.retrieve(attempt.stripeCheckoutSessionId);
  } catch (err) {
    const kind = classifyStripeCheckoutRetrieveFailure(err);
    if (kind === "transient" || kind === "unknown") {
      const result: FoundationCheckoutReconciliationResult = {
        classification: "UNKNOWN_PROVIDER_OUTCOME",
        attemptId: attempt.id,
        state: attempt.state,
        paymentStatus: attempt.paymentStatus,
        stripeCheckoutSessionId: attempt.stripeCheckoutSessionId,
        checkoutUrl: null,
        retryable: true,
        retrieveFailure: "transient",
      };
      logReconciliation(result);
      return result;
    }
    const result = await applyFoundationCheckoutProviderObservation(deps.prisma, attempt.id, {
      kind: "provider_not_found",
      stripeCheckoutSessionId: attempt.stripeCheckoutSessionId,
    });
    const withFailure: FoundationCheckoutReconciliationResult = { ...result, retrieveFailure: "not_found" };
    logReconciliation(withFailure);
    return withFailure;
  }

  const observation = observationFromStripeCheckoutSession(session);
  const applied = await applyFoundationCheckoutProviderObservation(deps.prisma, attempt.id, observation);

  if (applied.classification === "PAID_NEEDS_FULFILLMENT") {
    const fulfill =
      deps.fulfillPaidSession ??
      (async (cs: Stripe.Checkout.Session) => {
        await fulfillStoreOrdersFromCheckoutSession(deps.stripe as Stripe, cs, {
          logPrefix: "[foundation-checkout-reconcile]",
        });
      });
    try {
      await fulfill(session);
      const after = await loadAttempt(deps.prisma, attempt.id);
      const orders = await deps.prisma.storeOrder.findMany({
        where: { checkoutAttemptId: attempt.id },
        select: { status: true, commerceStatus: true },
      });
      const ops = await deps.prisma.transferOperation.findMany({
        where: { storeOrder: { checkoutAttemptId: attempt.id } },
        select: { status: true },
      });
      const unfulfillable = orders.some((order) => order.commerceStatus === "UNFULFILLABLE");
      const payoutUnresolved = ops.some(
        (op) =>
          op.status === "PENDING" ||
          op.status === "PROCESSING" ||
          op.status === "UNCERTAIN" ||
          op.status === "FAILED"
      );
      const localRepairOutstanding = await foundationSucceededPayoutLocalRepairOutstanding(
        deps.prisma,
        attempt.id
      );
      const saleComplete =
        orders.length > 0 && orders.every((order) => isFoundationBuyerSaleCompleteStatus(order.status));
      const classification: FoundationCheckoutReconciliationClassification = unfulfillable
        ? "PAID_NOT_CONVERTIBLE"
        : payoutUnresolved || localRepairOutstanding
          ? "PAID_NEEDS_FULFILLMENT"
          : saleComplete || after?.state === "PAID"
            ? "PAID_FINALIZED"
            : applied.classification;
      const finalized: FoundationCheckoutReconciliationResult = {
        ...applied,
        classification,
        state: after?.state ?? applied.state,
        paymentStatus: after?.paymentStatus ?? applied.paymentStatus,
        retryable: classification === "PAID_NEEDS_FULFILLMENT",
      };
      logReconciliation(finalized);
      return finalized;
    } catch (err) {
      console.error("[foundation-checkout-reconcile] paid fulfillment failed", {
        attemptId: attempt.id,
        stripeCheckoutSessionId: attempt.stripeCheckoutSessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      logReconciliation(applied);
      return applied;
    }
  }

  logReconciliation(applied);
  return applied;
}

export async function reconcileFoundationCheckoutBatch(args: {
  prisma: PrismaClient;
  stripe: StripeCheckoutRetrieveClient;
  mode: string | null | undefined;
  take?: number;
  now?: Date;
}): Promise<{
  skipped: string | null;
  inspected: number;
  results: Array<{ attemptId: string; classification: FoundationCheckoutReconciliationClassification }>;
}> {
  if (!foundationCheckoutReconciliationCronAllowed(args.mode)) {
    return { skipped: args.mode ? `mode_${args.mode}` : "mode_unavailable", inspected: 0, results: [] };
  }
  const candidates = await listFoundationCheckoutReconciliationCandidates(args.prisma, {
    take: args.take,
    now: args.now,
  });
  const results: Array<{ attemptId: string; classification: FoundationCheckoutReconciliationClassification }> = [];
  for (const candidate of candidates) {
    try {
      const result = await reconcileFoundationCheckoutAttempt({
        prisma: args.prisma,
        stripe: args.stripe,
        attemptId: candidate.id,
      });
      results.push({ attemptId: result.attemptId, classification: result.classification });
    } catch (err) {
      console.error("[foundation-checkout-reconcile] attempt failed", {
        attemptId: candidate.id,
        error: err instanceof Error ? err.message : String(err),
      });
      results.push({ attemptId: candidate.id, classification: "UNKNOWN_PROVIDER_OUTCOME" });
    }
  }
  return { skipped: null, inspected: results.length, results };
}
