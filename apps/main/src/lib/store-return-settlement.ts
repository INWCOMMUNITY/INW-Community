import type Stripe from "stripe";
import {
  FoundationReturnEntitlementCausalError,
  FoundationReturnEntitlementIntentConflictError,
  FoundationTransferIntentConflictError,
  FoundationTransferRefundBlockedError,
  prepareFoundationReturnSellerSettlement,
  prisma,
} from "database";
import { computeSellerTransferCents } from "@/lib/storefront-payout";
import { postReturnSellerEntitlementCents, sellerTransferReversalCents } from "@/lib/store-return";
import { markStoreReturnRefundedOnce } from "@/lib/store-return-receive";
import { executeSellerReturnEntitlement } from "@/lib/stripe/seller-return-entitlement";
import {
  ensureStorefrontTransferReversal,
  executeStorefrontBuyerRefund,
  isStorefrontReversalComplete,
  persistLocalStorefrontRefundCompletion,
  StorefrontReturnLedgerConflictError,
} from "@/lib/stripe/refund-store-order";

export type StoreReturnSettlementResult =
  | { kind: "SETTLED"; amountCents: number; newlyFinalized: boolean }
  | { kind: "ALREADY_COMPLETE"; amountCents: number }
  | { kind: "HISTORICALLY_SETTLED"; amountCents: number }
  | {
      kind: "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED";
      amountCents: number;
      classification: "HISTORICAL_REFUND_AMBIGUOUS" | "HISTORICAL_REFUND_ANOMALY";
      reasonCodes: string[];
      error: string;
    }
  | { kind: "NOT_RECEIVED"; error: string }
  | { kind: "INVALID_AMOUNT"; error: string }
  | { kind: "UNAUTHORIZED_SELLER"; error: string }
  | { kind: "SELLER_SETTLEMENT_PENDING"; error: string; httpStatus: number }
  | { kind: "SELLER_SETTLEMENT_FAILED"; error: string; httpStatus: number }
  | { kind: "BUYER_REFUND_PENDING"; error: string; httpStatus: number }
  | { kind: "BUYER_REFUND_FAILED"; error: string; httpStatus: number; reason?: "replay_window_expired" };

const SELLER_PENDING_MSG = "Seller settlement is unresolved; retry the same refund.";
const SELLER_FAILED_MSG = "Could not complete seller settlement.";
const BUYER_PENDING_MSG = "Refund provider outcome is uncertain; retry the same refund";

function sellerPending(error = SELLER_PENDING_MSG, httpStatus = 500): StoreReturnSettlementResult {
  return { kind: "SELLER_SETTLEMENT_PENDING", error, httpStatus };
}

function sellerFailed(error = SELLER_FAILED_MSG, httpStatus = 409): StoreReturnSettlementResult {
  return { kind: "SELLER_SETTLEMENT_FAILED", error, httpStatus };
}

function buyerPending(error = BUYER_PENDING_MSG, httpStatus = 500): StoreReturnSettlementResult {
  return { kind: "BUYER_REFUND_PENDING", error, httpStatus };
}

function buyerFailed(
  error: string,
  httpStatus = 500,
  reason?: "replay_window_expired"
): StoreReturnSettlementResult {
  return reason
    ? { kind: "BUYER_REFUND_FAILED", error, httpStatus, reason }
    : { kind: "BUYER_REFUND_FAILED", error, httpStatus };
}

function mapPrepareError(err: unknown): StoreReturnSettlementResult {
  if (err instanceof FoundationReturnEntitlementCausalError) {
    if (/must be received/i.test(err.message)) {
      return { kind: "NOT_RECEIVED", error: "Approve the return before marking it received." };
    }
    return sellerFailed(err.message, 409);
  }
  if (err instanceof FoundationReturnEntitlementIntentConflictError) {
    return sellerFailed(err.message, 409);
  }
  if (err instanceof FoundationTransferIntentConflictError) {
    return sellerFailed(err.message, 409);
  }
  if (err instanceof FoundationTransferRefundBlockedError) {
    if (err.disposition === "TRANSFER_IN_FLIGHT" || err.disposition === "TRANSFER_UNCERTAIN") {
      return sellerPending(
        "Seller payout is unresolved; operator reconciliation is required before refund.",
        409
      );
    }
    return sellerFailed(err.message, 409);
  }
  throw err;
}

function mapEntitlementIncomplete(
  kind: Exclude<
    Awaited<ReturnType<typeof executeSellerReturnEntitlement>>["kind"],
    "SUCCEEDED" | "ALREADY_SUCCEEDED"
  >
): StoreReturnSettlementResult {
  if (kind === "IN_FLIGHT" || kind === "UNCERTAIN") return sellerPending();
  return sellerFailed();
}

export function originalSaleTransferCentsFromOrder(order: {
  totalCents: number;
  subtotalCents: number;
}): number {
  return computeSellerTransferCents(order.totalCents, order.subtotalCents).sellerTransferCents;
}

/**
 * Timing-invariant return settlement: seller money first, buyer refund second,
 * local inventory/order convergence last. StoreReturn stays `received` until all
 * three complete. Physical receipt is never rolled back.
 */
export async function completeReceivedStoreReturnSettlement(args: {
  stripe: Stripe;
  storeOrderId: string;
  storeReturnId: string;
  memberId: string;
  now?: Date;
  /** Test/injectable client; production uses package singleton. */
  db?: typeof prisma;
}): Promise<StoreReturnSettlementResult> {
  const db = args.db ?? prisma;
  const storeReturn = await db.storeReturn.findUnique({ where: { id: args.storeReturnId } });
  const order = await db.storeOrder.findUnique({
    where: { id: args.storeOrderId },
    include: { items: true },
  });
  if (!storeReturn || !order || storeReturn.orderId !== args.storeOrderId) {
    return { kind: "NOT_RECEIVED", error: "Approve the return before marking it received." };
  }
  if (order.sellerId !== args.memberId) {
    return { kind: "UNAUTHORIZED_SELLER", error: "Order not found" };
  }
  if (storeReturn.status === "refunded") {
    return { kind: "ALREADY_COMPLETE", amountCents: storeReturn.refundAmountCents ?? 0 };
  }
  if (storeReturn.status !== "received") {
    return { kind: "NOT_RECEIVED", error: "Approve the return before marking it received." };
  }

  const amountCents = storeReturn.refundAmountCents;
  if (amountCents == null || amountCents < 0) {
    return {
      kind: "INVALID_AMOUNT",
      error: "Refund amount is invalid; operator reconciliation is required.",
    };
  }

  const originalSaleTransferCents = originalSaleTransferCentsFromOrder(order);
  const policy = {
    originalTransferCents: originalSaleTransferCents,
    chargeReturnShipping: storeReturn.chargeReturnShipping,
    returnLabelCostCents: storeReturn.returnLabelCostCents,
  };
  const entitlementAmountCents = postReturnSellerEntitlementCents(policy);
  const reversalAmountCents = sellerTransferReversalCents(policy);

  let prepared;
  try {
    prepared = await prepareFoundationReturnSellerSettlement(db, {
      storeOrderId: args.storeOrderId,
      memberId: args.memberId,
      storeReturnId: args.storeReturnId,
      originalSaleTransferCents,
      entitlementAmountCents,
      currency: "usd",
    });
  } catch (err) {
    return mapPrepareError(err);
  }

  let skipSellerLedgerDebit = true;
  let ledgerDebitCents = 0;

  if (prepared.kind === "HISTORICALLY_SETTLED") {
    // Strict R3: no entitlement, reversal, buyer refund, or ledger mutation.
    // Do not invent StoreReturn terminal history.
    return { kind: "HISTORICALLY_SETTLED", amountCents: amountCents ?? 0 };
  }

  if (prepared.kind === "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED") {
    return {
      kind: "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED",
      amountCents: amountCents ?? 0,
      classification: prepared.classification,
      reasonCodes: prepared.reasonCodes,
      error:
        "Historical refund compatibility requires operator review before seller settlement or buyer refund.",
    };
  }

  if (prepared.kind === "ORIGINAL_TRANSFER_SUCCEEDED") {
    const reversal = await ensureStorefrontTransferReversal(args.stripe, {
      transferId: prepared.stripeTransferId,
      storeOrderId: args.storeOrderId,
      amountCents: reversalAmountCents,
    });
    if (!isStorefrontReversalComplete(reversal.status)) {
      if (reversal.status === "uncertain") {
        return sellerPending(reversal.error ?? SELLER_PENDING_MSG, 500);
      }
      return sellerFailed(reversal.error ?? SELLER_FAILED_MSG, reversal.status === "conflict" ? 409 : 500);
    }
    skipSellerLedgerDebit = false;
    ledgerDebitCents = reversalAmountCents;
  } else if (prepared.kind === "NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT") {
    let entitlement;
    try {
      entitlement = await executeSellerReturnEntitlement(args.stripe, {
        storeOrderId: args.storeOrderId,
        now: args.now,
      });
    } catch {
      return sellerPending();
    }
    if (entitlement.kind !== "SUCCEEDED" && entitlement.kind !== "ALREADY_SUCCEEDED") {
      return mapEntitlementIncomplete(entitlement.kind);
    }
  } else if (prepared.kind !== "NO_TRANSFER_LOCKED_OUT_ZERO_ENTITLEMENT") {
    return sellerFailed();
  }

  const buyer = await executeStorefrontBuyerRefund({
    stripe: args.stripe,
    order,
    amountCents,
    reason: storeReturn.reason ?? "return_received",
    restock: true,
    restockOperationId: args.storeReturnId,
    restockKind: "PHYSICAL_RECEIPT",
    now: args.now,
  });
  if (buyer.status === "uncertain") {
    return buyerPending(buyer.error, buyer.httpStatus);
  }
  if (buyer.status === "replay_window_expired") {
    return buyerFailed(buyer.error, buyer.httpStatus, "replay_window_expired");
  }
  if (buyer.status === "failed") {
    return buyerFailed(buyer.error, buyer.httpStatus);
  }
  if (buyer.status === "conflict") {
    return buyerFailed(buyer.error, buyer.httpStatus);
  }

  try {
    await persistLocalStorefrontRefundCompletion({
      order,
      reason: storeReturn.reason ?? "return_received",
      note: storeReturn.note,
      restock: true,
      restockKind: "PHYSICAL_RECEIPT",
      restockOperationId: args.storeReturnId,
      ledgerDebitCents,
      skipSellerLedgerDebit,
      stripeRefund: buyer.status === "zero_amount" ? null : buyer.stripeRefund,
      locallyComplete: buyer.status === "zero_amount",
    });
  } catch (err) {
    if (err instanceof StorefrontReturnLedgerConflictError) {
      return buyerFailed(err.message, 409);
    }
    return buyerPending("Local return convergence is incomplete; retry the same refund.");
  }

  const newlyFinalized = await markStoreReturnRefundedOnce(db, {
    storeReturnId: args.storeReturnId,
    amountCents,
  });
  return { kind: "SETTLED", amountCents, newlyFinalized };
}
