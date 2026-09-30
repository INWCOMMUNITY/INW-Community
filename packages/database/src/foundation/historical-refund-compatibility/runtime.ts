import {
  canReconstructHistoricalSellerTransferCents,
  reconstructHistoricalSellerTransferCents,
} from "../historical-transfer-operation-backfill/amount";
import type {
  HistoricalRefundCompatibilityEvidence,
  HistoricalRefundCompatibilityReasonCode,
  HistoricalRefundCompatibilityRecord,
} from "./types";

/**
 * Shared runtime decision for every consumer of historical-refund compatibility.
 * Classifier taxonomy stays unchanged; callers must not re-invent this branching.
 *
 * Canonical TO / RefundOperation / SREO presence alone is NOT Foundation provenance.
 */
export type HistoricalRefundRuntimeAction =
  | "HISTORICAL_FINANCIAL_NOOP"
  | "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED"
  | "CONTINUE_ORDINARY_FOUNDATION";

export type HistoricalRefundRuntimeDecision = {
  action: HistoricalRefundRuntimeAction;
  classification: HistoricalRefundCompatibilityRecord["classification"];
  reasonCodes: HistoricalRefundCompatibilityReasonCode[];
  storeOrderId: string;
};

function blank(s: string | null | undefined): boolean {
  return s == null || s.trim() === "";
}

/** Scaffolding + canonical-op reason codes that may appear on a Foundation-op-only ANOMALY. */
const CANONICAL_FOUNDATION_OP_REASON_CODES: ReadonlySet<HistoricalRefundCompatibilityReasonCode> = new Set([
  "TRANSFER_OPERATION_PRESENT",
  "FOUNDATION_REFUND_OPERATION_PRESENT",
  "FOUNDATION_ENTITLEMENT_OPERATION_PRESENT",
]);

const CANONICAL_ONLY_ANOMALY_ALLOWED_REASONS: ReadonlySet<HistoricalRefundCompatibilityReasonCode> = new Set([
  "LEGACY_TRANSFER_ID_PRESENT",
  "ORDER_STATUS_REFUNDED",
  "TRANSFER_OPERATION_PRESENT",
  "TRANSFER_OPERATION_ABSENT",
  "FOUNDATION_REFUND_OPERATION_PRESENT",
  "FOUNDATION_REFUND_OPERATION_ABSENT",
  "FOUNDATION_ENTITLEMENT_OPERATION_PRESENT",
  "FOUNDATION_ENTITLEMENT_OPERATION_ABSENT",
]);

const HISTORICAL_LEDGER_CONTRADICTION_REASONS: ReadonlySet<HistoricalRefundCompatibilityReasonCode> = new Set([
  "SALE_LEDGER_DUPLICATE",
  "SALE_LEDGER_SELLER_MISMATCH",
  "SALE_LEDGER_AMOUNT_MISMATCH",
  "RETURN_DEBIT_DUPLICATE",
  "RETURN_DEBIT_SELLER_MISMATCH",
  "RETURN_DEBIT_AMOUNT_MISMATCH",
]);

/**
 * Legacy refund shape with at least one seller return-debit row.
 * Presence of historical return settlement evidence forces REVIEW when mixed with canonical ops.
 */
export function hasHistoricalLegacyReturnSettlementFingerprint(
  evidence: HistoricalRefundCompatibilityEvidence
): boolean {
  if (blank(evidence.stripeSellerTransferId)) return false;
  if (evidence.status !== "refunded") return false;
  const completion =
    !blank(evidence.stripeRefundId) || evidence.refundCompletedAt != null;
  if (!completion) return false;
  return evidence.returnDebits.some((r) => r.type === "return" && r.amountCents < 0);
}

/**
 * Exact historical settled fingerprint ignoring TO / RefundOperation / SREO.
 * Used so mixed R3 + stray canonical ops cannot CONTINUE.
 */
export function hasStrongHistoricalSettledFingerprintIgnoringCanonicalOps(
  evidence: HistoricalRefundCompatibilityEvidence
): boolean {
  if (blank(evidence.sellerId)) return false;
  if (blank(evidence.stripeSellerTransferId)) return false;
  if (evidence.status !== "refunded") return false;
  const completion =
    !blank(evidence.stripeRefundId) || evidence.refundCompletedAt != null;
  if (!completion) return false;
  if (!canReconstructHistoricalSellerTransferCents(evidence)) return false;
  const expected = reconstructHistoricalSellerTransferCents(evidence);
  if (expected <= 0) return false;

  const sales = evidence.saleLedgers.filter((r) => r.type === "sale");
  if (sales.length !== 1) return false;
  const sale = sales[0]!;
  if (sale.memberId !== evidence.sellerId) return false;
  if (sale.amountCents !== expected) return false;

  const returns = evidence.returnDebits.filter((r) => r.type === "return" && r.amountCents < 0);
  if (returns.length !== 1) return false;
  const debit = returns[0]!;
  if (debit.memberId !== evidence.sellerId) return false;
  if (debit.amountCents !== -expected) return false;
  return true;
}

/**
 * Ledger contradiction that would be ANOMALY even without canonical ops
 * (wrong owner/amount/duplicates), evaluated from raw evidence.
 */
export function hasHistoricalLedgerContradictionIgnoringCanonicalOps(
  evidence: HistoricalRefundCompatibilityEvidence
): boolean {
  if (blank(evidence.sellerId) || blank(evidence.stripeSellerTransferId)) return false;
  if (evidence.status !== "refunded") return false;
  if (!canReconstructHistoricalSellerTransferCents(evidence)) return false;
  const expected = reconstructHistoricalSellerTransferCents(evidence);
  if (expected <= 0) return false;
  const sellerId = evidence.sellerId!;

  const sales = evidence.saleLedgers.filter((r) => r.type === "sale");
  if (sales.length > 1) return true;
  if (sales.length === 1) {
    const sale = sales[0]!;
    if (sale.memberId !== sellerId) return true;
    if (sale.amountCents !== expected) return true;
  }

  const returns = evidence.returnDebits.filter((r) => r.type === "return" && r.amountCents < 0);
  if (returns.length > 1) return true;
  if (returns.length === 1) {
    const debit = returns[0]!;
    if (debit.memberId !== sellerId) return true;
    if (debit.amountCents !== -expected) return true;
  }
  return false;
}

export function hasHistoricalLedgerContradictionReasonCodes(
  reasonCodes: readonly HistoricalRefundCompatibilityReasonCode[]
): boolean {
  return reasonCodes.some((c) => HISTORICAL_LEDGER_CONTRADICTION_REASONS.has(c));
}

/**
 * True when every reason is in the allowlist and at least one canonical-op PRESENT code exists.
 * Unknown/future reason codes → false (forces REVIEW).
 */
export function isCanonicalFoundationOpOnlyAnomalyReasons(
  reasonCodes: readonly HistoricalRefundCompatibilityReasonCode[]
): boolean {
  if (reasonCodes.length === 0) return false;
  let sawCanonicalOp = false;
  for (const code of reasonCodes) {
    if (!CANONICAL_ONLY_ANOMALY_ALLOWED_REASONS.has(code)) return false;
    if (CANONICAL_FOUNDATION_OP_REASON_CODES.has(code)) sawCanonicalOp = true;
  }
  return sawCanonicalOp;
}

/**
 * @param evidence Required for safe ANOMALY provenance. When omitted on ANOMALY, defaults to REVIEW.
 */
export function resolveHistoricalRefundRuntimeDecision(
  record: HistoricalRefundCompatibilityRecord,
  evidence?: HistoricalRefundCompatibilityEvidence | null
): HistoricalRefundRuntimeDecision {
  const base = {
    classification: record.classification,
    reasonCodes: record.reasonCodes,
    storeOrderId: record.storeOrderId,
  };
  if (record.classification === "HISTORICAL_REFUND_ALREADY_SETTLED") {
    return { action: "HISTORICAL_FINANCIAL_NOOP", ...base };
  }
  if (record.classification === "HISTORICAL_REFUND_AMBIGUOUS") {
    return { action: "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED", ...base };
  }
  if (record.classification === "HISTORICAL_REFUND_ANOMALY") {
    // Default fail-closed.
    if (!evidence) {
      return { action: "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED", ...base };
    }

    if (hasStrongHistoricalSettledFingerprintIgnoringCanonicalOps(evidence)) {
      return { action: "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED", ...base };
    }
    if (
      hasHistoricalLedgerContradictionIgnoringCanonicalOps(evidence) ||
      hasHistoricalLedgerContradictionReasonCodes(record.reasonCodes)
    ) {
      return { action: "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED", ...base };
    }
    if (hasHistoricalLegacyReturnSettlementFingerprint(evidence)) {
      // Any historical return debit + anomaly (incl. stray TO/RO/SREO) → operator review.
      return { action: "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED", ...base };
    }

    // Narrow CONTINUE: canonical-op-only anomaly reasons and no historical return fingerprint.
    if (isCanonicalFoundationOpOnlyAnomalyReasons(record.reasonCodes)) {
      return { action: "CONTINUE_ORDINARY_FOUNDATION", ...base };
    }

    return { action: "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED", ...base };
  }
  return { action: "CONTINUE_ORDINARY_FOUNDATION", ...base };
}

export function isHistoricalRefundFinancialNoOp(decision: HistoricalRefundRuntimeDecision): boolean {
  return decision.action === "HISTORICAL_FINANCIAL_NOOP";
}

export function isHistoricalRefundCompatibilityReviewRequired(
  decision: HistoricalRefundRuntimeDecision
): boolean {
  return decision.action === "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED";
}

export function isHistoricalRefundOrdinaryFoundationFlow(
  decision: HistoricalRefundRuntimeDecision
): boolean {
  return decision.action === "CONTINUE_ORDINARY_FOUNDATION";
}

/** True when seller-financial mutation must not run (settled no-op or blocked review). */
export function mustBlockHistoricalSellerFinancialMutation(
  decision: HistoricalRefundRuntimeDecision
): boolean {
  return (
    decision.action === "HISTORICAL_FINANCIAL_NOOP" ||
    decision.action === "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED"
  );
}
