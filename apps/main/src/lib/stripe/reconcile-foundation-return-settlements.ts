import type Stripe from "stripe";
import {
  foundationCheckoutReconciliationCronAllowed,
  listFoundationReturnSettlementCandidates,
  FOUNDATION_RETURN_SETTLEMENT_RECONCILIATION_BATCH_SIZE,
  type PrismaClient,
} from "database";
import { completeReceivedStoreReturnSettlement } from "@/lib/store-return-settlement";

/**
 * Unit 5A omits a separate `operatorRequired` counter.
 * Unit-4 public results collapse buyer refund replay-window expiry into
 * BUYER_REFUND_FAILED (optional `reason: "replay_window_expired"`) and collapse
 * other operator-required seller states into SELLER_SETTLEMENT_FAILED / PENDING.
 * Counting operator-required from those kinds would require parsing human-readable
 * error strings or a Unit-4 taxonomy redesign. Neither is in 5A scope.
 */
export type FoundationReturnSettlementReconciliationSummary = {
  skipped: string | null;
  scanned: number;
  settled: number;
  alreadyComplete: number;
  notReceived: number;
  invalidAmount: number;
  unauthorizedSeller: number;
  sellerPending: number;
  sellerFailed: number;
  buyerPending: number;
  buyerFailed: number;
  errors: number;
};

function emptySummary(skipped: string | null): FoundationReturnSettlementReconciliationSummary {
  return {
    skipped,
    scanned: 0,
    settled: 0,
    alreadyComplete: 0,
    notReceived: 0,
    invalidAmount: 0,
    unauthorizedSeller: 0,
    sellerPending: 0,
    sellerFailed: 0,
    buyerPending: 0,
    buyerFailed: 0,
    errors: 0,
  };
}

function applyResult(
  summary: FoundationReturnSettlementReconciliationSummary,
  kind: string
): void {
  switch (kind) {
    case "SETTLED":
      summary.settled += 1;
      break;
    case "ALREADY_COMPLETE":
      summary.alreadyComplete += 1;
      break;
    case "HISTORICALLY_SETTLED":
      // Financial no-op replay — not an error; StoreReturn may remain received.
      summary.alreadyComplete += 1;
      break;
    case "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED":
      // Deterministic operator block; do not treat as retryable provider failure.
      summary.errors += 1;
      break;
    case "NOT_RECEIVED":
      summary.notReceived += 1;
      break;
    case "INVALID_AMOUNT":
      summary.invalidAmount += 1;
      break;
    case "UNAUTHORIZED_SELLER":
      summary.unauthorizedSeller += 1;
      break;
    case "SELLER_SETTLEMENT_PENDING":
      summary.sellerPending += 1;
      break;
    case "SELLER_SETTLEMENT_FAILED":
      summary.sellerFailed += 1;
      break;
    case "BUYER_REFUND_PENDING":
      summary.buyerPending += 1;
      break;
    case "BUYER_REFUND_FAILED":
      summary.buyerFailed += 1;
      break;
    default:
      summary.errors += 1;
  }
}

export async function reconcileFoundationReturnSettlementBatch(args: {
  prisma: PrismaClient;
  stripe: Stripe;
  mode: string | null | undefined;
  take?: number;
  now?: Date;
}): Promise<FoundationReturnSettlementReconciliationSummary> {
  if (!foundationCheckoutReconciliationCronAllowed(args.mode)) {
    return emptySummary(args.mode ? `mode_${args.mode}` : "mode_unavailable");
  }

  const candidates = await listFoundationReturnSettlementCandidates(args.prisma, {
    take: args.take ?? FOUNDATION_RETURN_SETTLEMENT_RECONCILIATION_BATCH_SIZE,
  });
  const summary = emptySummary(null);
  summary.scanned = candidates.length;

  for (const candidate of candidates) {
    try {
      const result = await completeReceivedStoreReturnSettlement({
        stripe: args.stripe,
        storeOrderId: candidate.storeOrderId,
        storeReturnId: candidate.storeReturnId,
        memberId: candidate.sellerId,
        now: args.now,
      });
      applyResult(summary, result.kind);
    } catch (err) {
      console.error("[foundation-return-settle-reconcile] candidate failed", {
        storeReturnId: candidate.storeReturnId,
        storeOrderId: candidate.storeOrderId,
        error: err instanceof Error ? err.message : String(err),
      });
      summary.errors += 1;
    }
  }

  return summary;
}
