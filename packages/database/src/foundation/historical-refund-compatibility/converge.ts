import type { PrismaClient } from "@prisma/client";
import { loadHistoricalRefundCompatibilityEvidence } from "./analyze";
import { classifyHistoricalRefundCompatibility, isHistoricalRefundAlreadySettled } from "./classify";
import {
  mustBlockHistoricalSellerFinancialMutation,
  resolveHistoricalRefundRuntimeDecision,
  type HistoricalRefundRuntimeDecision,
} from "./runtime";

type ConvergenceDb = {
  storeOrder: PrismaClient["storeOrder"];
  sellerBalance: PrismaClient["sellerBalance"];
  sellerBalanceTransaction: PrismaClient["sellerBalanceTransaction"];
  transferOperation: PrismaClient["transferOperation"];
  refundOperation: PrismaClient["refundOperation"];
  sellerReturnEntitlementOperation: PrismaClient["sellerReturnEntitlementOperation"];
  $transaction: PrismaClient["$transaction"];
  $executeRaw: PrismaClient["$executeRaw"];
};

/**
 * Financial portion of external-refund restock convergence.
 * When historically settled: never creates a second seller return debit.
 * Caller owns inventory restock and StoreOrder.inventoryRestoredAt updates.
 */
export async function shouldSkipSellerLedgerDebitForHistoricalRefund(
  db: ConvergenceDb,
  storeOrderId: string
): Promise<boolean> {
  const evidence = await loadHistoricalRefundCompatibilityEvidence(db, storeOrderId);
  const record = classifyHistoricalRefundCompatibility(evidence);
  return isHistoricalRefundAlreadySettled(record);
}

/**
 * Load classifier + shared runtime decision for external-refund / settlement callers.
 */
export async function loadHistoricalRefundRuntimeDecision(
  db: ConvergenceDb,
  storeOrderId: string
): Promise<HistoricalRefundRuntimeDecision> {
  const evidence = await loadHistoricalRefundCompatibilityEvidence(db, storeOrderId);
  const record = classifyHistoricalRefundCompatibility(evidence);
  return resolveHistoricalRefundRuntimeDecision(record, evidence);
}

export type HistoricalExternalRefundRestockBranchResult = {
  handled: boolean;
  decision: HistoricalRefundRuntimeDecision;
  inventoryUpdated: boolean;
  sellerDebitApplied: false;
};

/**
 * Exact historical branch used by restockAfterExternalRefund for SETTLED / AMBIGUOUS / REVIEW:
 * StoreOrder-first lock, inventory timestamp convergence, zero seller debit / TO / entitlement.
 * Returns handled=false only for CONTINUE_ORDINARY_FOUNDATION.
 *
 * Inventory policy: external-refund restock is independently justified by the refunded order /
 * provider event that invoked this path; financial ambiguity must never block inventory repair
 * and must never cause a second seller debit.
 */
export async function runHistoricalExternalRefundRestockBranch(
  db: ConvergenceDb,
  orderId: string,
  args?: {
    /** Inventory line restock against the open Prisma transaction (full interactive tx). */
    restockLines?: (
      tx: never,
      order: { id: string; sellerId: string; status: string; inventoryRestoredAt: Date | null }
    ) => Promise<void>;
  }
): Promise<HistoricalExternalRefundRestockBranchResult> {
  const decision = await loadHistoricalRefundRuntimeDecision(db, orderId);
  if (!mustBlockHistoricalSellerFinancialMutation(decision)) {
    return { handled: false, decision, inventoryUpdated: false, sellerDebitApplied: false };
  }

  let inventoryUpdated = false;
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "StoreOrder" WHERE "id" = ${orderId} FOR UPDATE`;
    const locked = await tx.storeOrder.findUnique({ where: { id: orderId } });
    if (!locked) return;
    if (locked.inventoryRestoredAt) return;

    await tx.storeOrder.update({
      where: { id: locked.id },
      data: {
        status: "refunded",
        inventoryRestoredAt: new Date(),
        cancelReason: locked.cancelReason ?? "Refunded in Stripe",
        refundInitiatedAt: locked.refundInitiatedAt ?? new Date(),
      },
    });
    if (args?.restockLines) {
      await args.restockLines(tx as never, locked);
    }
    inventoryUpdated = true;
  });

  return {
    handled: true,
    decision,
    inventoryUpdated,
    sellerDebitApplied: false,
  };
}
