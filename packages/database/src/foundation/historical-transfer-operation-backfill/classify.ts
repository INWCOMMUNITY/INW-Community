import {
  canReconstructHistoricalSellerTransferCents,
  reconstructHistoricalSellerTransferCents,
} from "./amount";
import {
  buildExpectedHistoricalTransferOperation,
  existingTransferOperationAsRow,
  isExactHistoricalTransferOperationMatch,
} from "./equivalence";
import {
  HISTORICAL_STOREFRONT_TRANSFER_CURRENCY,
  type HistoricalToCandidateEvidence,
  type HistoricalToCandidateRecord,
  type HistoricalToClassification,
  type HistoricalToReasonCode,
} from "./types";

export function maskStripeTransferId(id: string | null | undefined): string | null {
  if (id == null) return null;
  const s = id.trim();
  if (!s) return null;
  if (s.length <= 8) return `${s.slice(0, 2)}…${s.slice(-2)}`;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function blank(id: string | null | undefined): boolean {
  return id == null || id.trim() === "";
}

/**
 * Pure classifier. Missing sale-ledger stripeTransferId is NORMAL historical behavior
 * and must not alone downgrade R1 (Prompt 131: all 17 sale ledgers lacked transfer IDs).
 */
export function classifyHistoricalTransferOperationCandidate(
  evidence: HistoricalToCandidateEvidence
): HistoricalToCandidateRecord {
  const reasonCodes: HistoricalToReasonCode[] = [];
  const legacyRaw = evidence.stripeSellerTransferId?.trim() || null;
  const legacyTransferIdMasked = maskStripeTransferId(legacyRaw);

  const base = (): Omit<
    HistoricalToCandidateRecord,
    "classification" | "reasonCodes" | "expectedAmountCents" | "saleLedgerAmountCents" | "saleLedgerCreatedAt" | "saleLedgerHasStripeTransferId"
  > & {
    expectedAmountCents: number | null;
    saleLedgerAmountCents: number | null;
    saleLedgerCreatedAt: string | null;
    saleLedgerHasStripeTransferId: boolean;
  } => {
    const sale = evidence.saleLedgers[0] ?? null;
    return {
      storeOrderId: evidence.storeOrderId,
      memberId: evidence.sellerId,
      legacyTransferId: legacyRaw,
      legacyTransferIdMasked,
      currency: HISTORICAL_STOREFRONT_TRANSFER_CURRENCY,
      orderStatus: evidence.status,
      saleLedgerCount: evidence.saleLedgers.length,
      saleLedgerAmountCents: sale?.amountCents ?? null,
      saleLedgerCreatedAt: sale?.createdAt ? sale.createdAt.toISOString() : null,
      saleLedgerHasStripeTransferId: Boolean(sale?.stripeTransferId),
      returnDebitCount: evidence.returnDebits.length,
      hasStripeRefundId: !blank(evidence.stripeRefundId),
      hasRefundCompletedAt: evidence.refundCompletedAt != null,
      existingTransferOperationId: evidence.existingTransferOperation?.id ?? null,
      expectedAmountCents: null,
    };
  };

  if (evidence.existingTransferOperation) {
    reasonCodes.push("EXISTING_TRANSFER_OPERATION");
    const expected = buildExpectedHistoricalTransferOperation(evidence);
    if (
      expected &&
      isExactHistoricalTransferOperationMatch(
        existingTransferOperationAsRow(evidence.existingTransferOperation),
        expected
      )
    ) {
      return {
        ...base(),
        expectedAmountCents: expected.amountCents,
        classification: "ALREADY_CANONICAL",
        reasonCodes,
      };
    }
    reasonCodes.push("EXISTING_TRANSFER_OPERATION_CONFLICT");
    return {
      ...base(),
      expectedAmountCents: expected?.amountCents ?? null,
      classification: "R4_DATA_INCONSISTENCY",
      reasonCodes,
    };
  }

  if (blank(legacyRaw)) {
    reasonCodes.push("LEGACY_TRANSFER_ID_BLANK");
    return {
      ...base(),
      expectedAmountCents: null,
      classification: "NOT_A_LEGACY_TRANSFER_CANDIDATE",
      reasonCodes,
    };
  }
  reasonCodes.push("LEGACY_TRANSFER_ID_PRESENT");

  if (!evidence.sellerId || evidence.sellerId.trim() === "") {
    reasonCodes.push("SELLER_ID_MISSING");
    return {
      ...base(),
      expectedAmountCents: null,
      classification: "R4_DATA_INCONSISTENCY",
      reasonCodes,
    };
  }

  if (evidence.canonicalKeyCollision) {
    reasonCodes.push("CANONICAL_KEY_COLLISION");
    return {
      ...base(),
      expectedAmountCents: null,
      classification: "R4_DATA_INCONSISTENCY",
      reasonCodes,
    };
  }

  if (evidence.transferIdOwnedElsewhere) {
    reasonCodes.push("TRANSFER_ID_OWNED_BY_OTHER_OPERATION");
    return {
      ...base(),
      expectedAmountCents: null,
      classification: "R4_DATA_INCONSISTENCY",
      reasonCodes,
    };
  }

  if (!canReconstructHistoricalSellerTransferCents(evidence)) {
    reasonCodes.push("EXPECTED_AMOUNT_MISSING_INPUTS");
    return {
      ...base(),
      expectedAmountCents: null,
      classification: "R2_AMOUNT_OR_LEDGER_AMBIGUOUS",
      reasonCodes,
    };
  }

  const expectedAmountCents = reconstructHistoricalSellerTransferCents({
    totalCents: evidence.totalCents!,
    platformFeeCents: evidence.platformFeeCents!,
    salesTaxReserveCents: evidence.salesTaxReserveCents!,
  });
  reasonCodes.push("EXPECTED_AMOUNT_RECONSTRUCTED");

  if (expectedAmountCents <= 0) {
    reasonCodes.push("EXPECTED_AMOUNT_NON_POSITIVE");
    return {
      ...base(),
      expectedAmountCents,
      classification: "R2_AMOUNT_OR_LEDGER_AMBIGUOUS",
      reasonCodes,
    };
  }

  if (evidence.saleLedgers.length === 0) {
    reasonCodes.push("SALE_LEDGER_MISSING");
    return {
      ...base(),
      expectedAmountCents,
      classification: "R2_AMOUNT_OR_LEDGER_AMBIGUOUS",
      reasonCodes,
    };
  }

  if (evidence.saleLedgers.length > 1) {
    reasonCodes.push("SALE_LEDGER_MULTIPLE");
    return {
      ...base(),
      expectedAmountCents,
      classification: "R2_AMOUNT_OR_LEDGER_AMBIGUOUS",
      reasonCodes,
    };
  }

  const sale = evidence.saleLedgers[0]!;
  if (sale.memberId !== evidence.sellerId) {
    reasonCodes.push("SALE_LEDGER_SELLER_MISMATCH");
    return {
      ...base(),
      expectedAmountCents,
      classification: "R4_DATA_INCONSISTENCY",
      reasonCodes,
    };
  }

  if (sale.stripeTransferId && sale.stripeTransferId !== legacyRaw) {
    reasonCodes.push("SALE_LEDGER_TRANSFER_ID_CONFLICT");
    return {
      ...base(),
      expectedAmountCents,
      classification: "R4_DATA_INCONSISTENCY",
      reasonCodes,
    };
  }

  if (sale.amountCents !== expectedAmountCents) {
    reasonCodes.push("SALE_LEDGER_AMOUNT_MISMATCH");
    return {
      ...base(),
      expectedAmountCents,
      classification: "R2_AMOUNT_OR_LEDGER_AMBIGUOUS",
      reasonCodes,
    };
  }
  reasonCodes.push("SALE_LEDGER_EXACT_ONE_AMOUNT_MATCH");

  const hasRefundCompletion =
    !blank(evidence.stripeRefundId) || evidence.refundCompletedAt != null;
  const hasReturnDebit = evidence.returnDebits.length > 0;
  if (hasReturnDebit) {
    reasonCodes.push("RETURN_DEBIT_PRESENT");
  }

  // R3 requires positive settlement evidence — not status alone.
  if (evidence.status === "refunded" && hasRefundCompletion && hasReturnDebit) {
    reasonCodes.push("LEGACY_REFUND_COMPLETED_WITH_RETURN_DEBIT");
    return {
      ...base(),
      expectedAmountCents,
      classification: "R3_ALREADY_REFUNDED_LEGACY",
      reasonCodes,
    };
  }

  if (evidence.status === "refunded" && (!hasRefundCompletion || !hasReturnDebit)) {
    reasonCodes.push("REFUNDED_STATUS_WITHOUT_SETTLEMENT_EVIDENCE");
    return {
      ...base(),
      expectedAmountCents,
      classification: "R2_AMOUNT_OR_LEDGER_AMBIGUOUS",
      reasonCodes,
    };
  }

  // Residual return debit without full R3 shape → fail closed (avoid paid-first TO).
  if (hasReturnDebit) {
    reasonCodes.push("RETURN_DEBIT_PRESENT");
    return {
      ...base(),
      expectedAmountCents,
      classification: "R2_AMOUNT_OR_LEDGER_AMBIGUOUS",
      reasonCodes,
    };
  }

  return {
    ...base(),
    expectedAmountCents,
    classification: "R1_UNAMBIGUOUS_PAID" satisfies HistoricalToClassification,
    reasonCodes,
  };
}
