import {
  canReconstructHistoricalSellerTransferCents,
  reconstructHistoricalSellerTransferCents,
} from "../historical-transfer-operation-backfill/amount";
import type {
  HistoricalRefundCompatibilityClassification,
  HistoricalRefundCompatibilityEvidence,
  HistoricalRefundCompatibilityReasonCode,
  HistoricalRefundCompatibilityRecord,
} from "./types";

function blank(s: string | null | undefined): boolean {
  return s == null || s.trim() === "";
}

export function maskStripeTransferId(id: string | null | undefined): string | null {
  if (blank(id)) return null;
  const t = id!.trim();
  if (t.length <= 10) return `${t.slice(0, 4)}…`;
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

/**
 * Pure strict historical-refund compatibility classifier.
 * SETTLED requires exact sale + exact seller-matched return debit + refunded completion + no TO/Foundation ops.
 */
export function classifyHistoricalRefundCompatibility(
  evidence: HistoricalRefundCompatibilityEvidence
): HistoricalRefundCompatibilityRecord {
  const reasonCodes: HistoricalRefundCompatibilityReasonCode[] = [];
  const base = (): Omit<
    HistoricalRefundCompatibilityRecord,
    "classification" | "reasonCodes" | "expectedSellerTransferCents" | "saleLedgerAmountCents" | "returnDebitAmountCents"
  > & {
    expectedSellerTransferCents: number | null;
    saleLedgerAmountCents: number | null;
    returnDebitAmountCents: number | null;
  } => ({
    storeOrderId: evidence.storeOrderId,
    sellerId: evidence.sellerId,
    expectedSellerTransferCents: null,
    orderStatus: evidence.status,
    legacyTransferIdMasked: maskStripeTransferId(evidence.stripeSellerTransferId),
    hasStripeRefundId: !blank(evidence.stripeRefundId),
    hasRefundCompletedAt: evidence.refundCompletedAt != null,
    saleLedgerCount: evidence.saleLedgers.length,
    saleLedgerAmountCents: null,
    returnDebitCount: evidence.returnDebits.length,
    returnDebitAmountCents: null,
    hasTransferOperation: evidence.transferOperation != null,
    transferOperationStatus: evidence.transferOperation?.status ?? null,
    refundOperationCount: evidence.refundOperationCount,
    sellerReturnEntitlementOperationCount: evidence.sellerReturnEntitlementOperationCount,
  });

  const finish = (
    classification: HistoricalRefundCompatibilityClassification,
    codes: HistoricalRefundCompatibilityReasonCode[],
    extras?: Partial<HistoricalRefundCompatibilityRecord>
  ): HistoricalRefundCompatibilityRecord => ({
    ...base(),
    ...extras,
    classification,
    reasonCodes: codes,
  });

  if (blank(evidence.sellerId)) {
    reasonCodes.push("SELLER_IDENTITY_MISSING");
    return finish("NOT_HISTORICAL_LEGACY_REFUND", reasonCodes);
  }
  const sellerId = evidence.sellerId!;

  if (blank(evidence.stripeSellerTransferId)) {
    reasonCodes.push("LEGACY_TRANSFER_ID_MISSING");
    return finish("NOT_HISTORICAL_LEGACY_REFUND", reasonCodes);
  }
  reasonCodes.push("LEGACY_TRANSFER_ID_PRESENT");

  // Active (non-refunded) Foundation sales mirror stripeSellerTransferId onto StoreOrder when TO
  // succeeds. Exit before Foundation-op anomaly gates so ordinary payout/refund continues.
  if (evidence.status !== "refunded") {
    reasonCodes.push("ORDER_STATUS_NOT_REFUNDED");
    return finish("NOT_HISTORICAL_LEGACY_REFUND", reasonCodes);
  }
  reasonCodes.push("ORDER_STATUS_REFUNDED");

  if (evidence.transferOperation) {
    reasonCodes.push("TRANSFER_OPERATION_PRESENT");
    return finish("HISTORICAL_REFUND_ANOMALY", reasonCodes);
  }
  reasonCodes.push("TRANSFER_OPERATION_ABSENT");

  if (evidence.refundOperationCount > 0) {
    reasonCodes.push("FOUNDATION_REFUND_OPERATION_PRESENT");
    return finish("HISTORICAL_REFUND_ANOMALY", reasonCodes);
  }
  reasonCodes.push("FOUNDATION_REFUND_OPERATION_ABSENT");

  if (evidence.sellerReturnEntitlementOperationCount > 0) {
    reasonCodes.push("FOUNDATION_ENTITLEMENT_OPERATION_PRESENT");
    return finish("HISTORICAL_REFUND_ANOMALY", reasonCodes);
  }
  reasonCodes.push("FOUNDATION_ENTITLEMENT_OPERATION_ABSENT");

  if (!canReconstructHistoricalSellerTransferCents(evidence)) {
    reasonCodes.push("EXPECTED_AMOUNT_MISSING_INPUTS");
    return finish("HISTORICAL_REFUND_AMBIGUOUS", reasonCodes);
  }
  const expected = reconstructHistoricalSellerTransferCents(evidence);
  reasonCodes.push("EXPECTED_AMOUNT_RECONSTRUCTED");
  if (expected <= 0) {
    reasonCodes.push("EXPECTED_AMOUNT_NON_POSITIVE");
    return finish("HISTORICAL_REFUND_AMBIGUOUS", reasonCodes, { expectedSellerTransferCents: expected });
  }

  // Sale ledger: all sale rows for order (any seller) then enforce exact seller match.
  const allSales = evidence.saleLedgers.filter((r) => r.type === "sale");
  if (allSales.length === 0) {
    reasonCodes.push("SALE_LEDGER_MISSING");
    return finish("HISTORICAL_REFUND_AMBIGUOUS", reasonCodes, { expectedSellerTransferCents: expected });
  }
  if (allSales.length > 1) {
    reasonCodes.push("SALE_LEDGER_DUPLICATE");
    return finish("HISTORICAL_REFUND_ANOMALY", reasonCodes, { expectedSellerTransferCents: expected });
  }
  const sale = allSales[0]!;
  if (sale.memberId !== sellerId) {
    reasonCodes.push("SALE_LEDGER_SELLER_MISMATCH");
    return finish("HISTORICAL_REFUND_ANOMALY", reasonCodes, {
      expectedSellerTransferCents: expected,
      saleLedgerAmountCents: sale.amountCents,
    });
  }
  if (sale.amountCents !== expected) {
    reasonCodes.push("SALE_LEDGER_AMOUNT_MISMATCH");
    return finish("HISTORICAL_REFUND_ANOMALY", reasonCodes, {
      expectedSellerTransferCents: expected,
      saleLedgerAmountCents: sale.amountCents,
    });
  }
  reasonCodes.push("SALE_LEDGER_EXACT_ONE");

  const hasRefundCompletion =
    !blank(evidence.stripeRefundId) || evidence.refundCompletedAt != null;
  if (!hasRefundCompletion) {
    reasonCodes.push("REFUND_NOT_COMPLETED");
    return finish("HISTORICAL_REFUND_AMBIGUOUS", reasonCodes, {
      expectedSellerTransferCents: expected,
      saleLedgerAmountCents: sale.amountCents,
    });
  }
  reasonCodes.push("REFUND_COMPLETION_PRESENT");

  // Return debits: any negative return for order — then enforce seller+amount.
  const allReturns = evidence.returnDebits.filter((r) => r.type === "return" && r.amountCents < 0);
  if (allReturns.length === 0) {
    reasonCodes.push("RETURN_DEBIT_MISSING");
    return finish("HISTORICAL_REFUND_AMBIGUOUS", reasonCodes, {
      expectedSellerTransferCents: expected,
      saleLedgerAmountCents: sale.amountCents,
    });
  }
  if (allReturns.length > 1) {
    reasonCodes.push("RETURN_DEBIT_DUPLICATE");
    return finish("HISTORICAL_REFUND_ANOMALY", reasonCodes, {
      expectedSellerTransferCents: expected,
      saleLedgerAmountCents: sale.amountCents,
      returnDebitCount: allReturns.length,
    });
  }
  const debit = allReturns[0]!;
  if (debit.memberId !== sellerId) {
    reasonCodes.push("RETURN_DEBIT_SELLER_MISMATCH");
    return finish("HISTORICAL_REFUND_ANOMALY", reasonCodes, {
      expectedSellerTransferCents: expected,
      saleLedgerAmountCents: sale.amountCents,
      returnDebitAmountCents: debit.amountCents,
    });
  }
  if (debit.amountCents !== -expected) {
    reasonCodes.push("RETURN_DEBIT_AMOUNT_MISMATCH");
    return finish("HISTORICAL_REFUND_ANOMALY", reasonCodes, {
      expectedSellerTransferCents: expected,
      saleLedgerAmountCents: sale.amountCents,
      returnDebitAmountCents: debit.amountCents,
    });
  }
  reasonCodes.push("RETURN_DEBIT_EXACT_ONE");
  reasonCodes.push("HISTORICAL_REFUND_ALREADY_SETTLED");

  return finish("HISTORICAL_REFUND_ALREADY_SETTLED", reasonCodes, {
    expectedSellerTransferCents: expected,
    saleLedgerAmountCents: sale.amountCents,
    returnDebitAmountCents: debit.amountCents,
  });
}

export function isHistoricalRefundAlreadySettled(
  record: HistoricalRefundCompatibilityRecord
): boolean {
  return record.classification === "HISTORICAL_REFUND_ALREADY_SETTLED";
}
