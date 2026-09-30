import type Stripe from "stripe";
import type { SellerReturnEntitlementOperation } from "database";
import {
  beginFoundationReturnEntitlementAttempt,
  classifyStripeTransferFailure,
  completeFoundationSellerReturnEntitlementLedger,
  FOUNDATION_RETURN_ENTITLEMENT_SNAPSHOT_MISSING_AFTER_ATTEMPT,
  FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID,
  persistFoundationReturnEntitlementOutcome,
  persistFoundationReturnEntitlementPreflightFailure,
  persistFoundationReturnEntitlementSuccess,
  prisma,
  type FoundationReturnEntitlementBeginAction,
} from "database";
import { retrieveCheckoutChargeId } from "@/lib/stripe/source-charge";

export type SellerReturnEntitlementExecutionResult =
  | {
      kind: "SUCCEEDED";
      operation: SellerReturnEntitlementOperation;
      ledgerCreated: boolean;
      stripeTransferId: string;
    }
  | {
      kind: "ALREADY_SUCCEEDED";
      operation: SellerReturnEntitlementOperation;
      ledgerCreated: boolean;
      stripeTransferId: string;
    }
  | { kind: "IN_FLIGHT"; operation: SellerReturnEntitlementOperation }
  | { kind: "FAILED_REQUIRES_RESET"; operation: SellerReturnEntitlementOperation }
  | { kind: "FAILED"; operation: SellerReturnEntitlementOperation; lastError: string }
  | { kind: "UNCERTAIN"; operation: SellerReturnEntitlementOperation; lastError: string }
  | { kind: "REPLAY_WINDOW_EXPIRED"; operation: SellerReturnEntitlementOperation }
  | { kind: "SUCCEEDED_WITHOUT_TRANSFER_ID"; operation: SellerReturnEntitlementOperation }
  | { kind: "NOT_FOUND" };

const LOG = "[seller-return-entitlement]";

async function repairEntitlementLedger(storeOrderId: string): Promise<{ ledgerCreated: boolean }> {
  try {
    return await completeFoundationSellerReturnEntitlementLedger(prisma, { storeOrderId });
  } catch (err) {
    console.error(`${LOG} entitlement ledger repair failed`, err);
    throw err;
  }
}

function frozenDestination(operation: SellerReturnEntitlementOperation): string {
  return operation.stripeDestinationAccountId?.trim() || "";
}

function frozenSourceCharge(operation: SellerReturnEntitlementOperation): string {
  return operation.stripeSourceChargeId?.trim() || "";
}

/**
 * Executes a durable SellerReturnEntitlementOperation against Stripe Connect.
 * Does not recalculate entitlement economics, refund the buyer, reverse a sale transfer,
 * restock inventory, or mutate StoreOrder / StoreReturn status.
 *
 * Live Connect / Charge lookup happens only for the first provider attempt.
 * Same-key replay uses the frozen snapshot on the entitlement row.
 */
export async function executeSellerReturnEntitlement(
  stripe: Stripe,
  args: { storeOrderId: string; now?: Date }
): Promise<SellerReturnEntitlementExecutionResult> {
  const order = await prisma.storeOrder.findUnique({
    where: { id: args.storeOrderId },
    select: { id: true, sellerId: true, stripePaymentIntentId: true },
  });
  if (!order) return { kind: "NOT_FOUND" };

  const existing = await prisma.sellerReturnEntitlementOperation.findUnique({
    where: { storeOrderId: args.storeOrderId },
  });
  if (!existing) return { kind: "NOT_FOUND" };

  let began = await beginFoundationReturnEntitlementAttempt(prisma, {
    storeOrderId: args.storeOrderId,
    now: args.now,
  });

  if (began.action === "needs_provider_snapshot") {
    const seller = await prisma.member.findUnique({
      where: { id: order.sellerId },
      select: { stripeConnectAccountId: true },
    });
    const connectId = seller?.stripeConnectAccountId?.trim() || "";
    const chargeId = connectId
      ? await retrieveCheckoutChargeId(stripe, order.stripePaymentIntentId, LOG)
      : null;

    if (!connectId || !chargeId) {
      const lastError = !connectId ? "missing_connect_account" : "missing_charge";
      const preflight = await persistFoundationReturnEntitlementPreflightFailure(prisma, {
        storeOrderId: args.storeOrderId,
        lastError,
      });
      if (preflight.kind === "not_found") return { kind: "NOT_FOUND" };
      if (preflight.kind === "failed") {
        return { kind: "FAILED", operation: preflight.operation, lastError };
      }
      began = await beginFoundationReturnEntitlementAttempt(prisma, {
        storeOrderId: args.storeOrderId,
        now: args.now,
      });
    } else {
      began = await beginFoundationReturnEntitlementAttempt(prisma, {
        storeOrderId: args.storeOrderId,
        now: args.now,
        providerSnapshot: {
          stripeDestinationAccountId: connectId,
          stripeSourceChargeId: chargeId,
        },
      });
    }
  }

  return settleFromBegin(stripe, order, began, args.storeOrderId);
}

async function settleFromBegin(
  stripe: Stripe,
  order: { id: string; sellerId: string; stripePaymentIntentId: string | null },
  began: FoundationReturnEntitlementBeginAction,
  storeOrderId: string
): Promise<SellerReturnEntitlementExecutionResult> {
  if (began.action === "not_found") return { kind: "NOT_FOUND" };

  if (began.action === "needs_provider_snapshot") {
    return { kind: "UNCERTAIN", operation: began.operation, lastError: "provider_snapshot_unresolved" };
  }

  if (began.action === "already_succeeded") {
    const ledger = await repairEntitlementLedger(storeOrderId);
    return {
      kind: "ALREADY_SUCCEEDED",
      operation: began.operation,
      ledgerCreated: ledger.ledgerCreated,
      stripeTransferId: began.operation.stripeTransferId as string,
    };
  }

  if (began.action === "skip_failed") {
    return { kind: "FAILED_REQUIRES_RESET", operation: began.operation };
  }

  if (began.action === "skip_in_flight") {
    return { kind: "IN_FLIGHT", operation: began.operation };
  }

  if (began.action === "operator_required") {
    if (began.reason === FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID) {
      return { kind: "SUCCEEDED_WITHOUT_TRANSFER_ID", operation: began.operation };
    }
    if (began.reason === FOUNDATION_RETURN_ENTITLEMENT_SNAPSHOT_MISSING_AFTER_ATTEMPT) {
      return {
        kind: "UNCERTAIN",
        operation: began.operation,
        lastError: FOUNDATION_RETURN_ENTITLEMENT_SNAPSHOT_MISSING_AFTER_ATTEMPT,
      };
    }
    return { kind: "REPLAY_WINDOW_EXPIRED", operation: began.operation };
  }

  const destination = frozenDestination(began.operation);
  const sourceCharge = frozenSourceCharge(began.operation);
  if (!destination || !sourceCharge) {
    const outcome = await persistFoundationReturnEntitlementOutcome(prisma, {
      storeOrderId,
      status: "UNCERTAIN",
      lastError: FOUNDATION_RETURN_ENTITLEMENT_SNAPSHOT_MISSING_AFTER_ATTEMPT,
    });
    return {
      kind: "UNCERTAIN",
      operation: outcome,
      lastError: FOUNDATION_RETURN_ENTITLEMENT_SNAPSHOT_MISSING_AFTER_ATTEMPT,
    };
  }

  try {
    const transfer = await stripe.transfers.create(
      {
        amount: began.operation.amountCents,
        currency: began.operation.currency,
        destination,
        source_transaction: sourceCharge,
        metadata: {
          orderId: order.id,
          storeReturnId: began.operation.storeReturnId,
          sellerReturnEntitlementOperationId: began.operation.id,
        },
      },
      { idempotencyKey: began.operation.providerIdempotencyKey }
    );

    let succeeded: SellerReturnEntitlementOperation;
    try {
      succeeded = await persistFoundationReturnEntitlementSuccess(prisma, {
        storeOrderId,
        stripeTransferId: transfer.id,
      });
    } catch (persistErr) {
      console.error(`${LOG} persist entitlement success failed`, persistErr);
      return {
        kind: "UNCERTAIN",
        operation: began.operation,
        lastError: persistErr instanceof Error ? persistErr.message : "persist_success_failed",
      };
    }

    const ledger = await repairEntitlementLedger(storeOrderId);
    return {
      kind: "SUCCEEDED",
      operation: succeeded,
      ledgerCreated: ledger.ledgerCreated,
      stripeTransferId: transfer.id,
    };
  } catch (transferErr) {
    const kind = classifyStripeTransferFailure(transferErr);
    const lastError = transferErr instanceof Error ? transferErr.message : String(transferErr);
    console.error(`${LOG} Connect entitlement transfer ${kind}:`, transferErr);
    const outcome = await persistFoundationReturnEntitlementOutcome(prisma, {
      storeOrderId,
      status: kind === "failed" ? "FAILED" : "UNCERTAIN",
      lastError,
    });
    return kind === "failed"
      ? { kind: "FAILED", operation: outcome, lastError }
      : { kind: "UNCERTAIN", operation: outcome, lastError };
  }
}
