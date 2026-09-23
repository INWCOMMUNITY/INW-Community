/**
 * Historical TransferOperation hybrid backfill — types only.
 * Canonicalizes durable payout evidence; never calls Stripe or moves money.
 */

export const HISTORICAL_TO_BACKFILL_MANIFEST_VERSION = 1 as const;

/**
 * Storefront Connect transfers are created with currency "usd" (fulfill-storefront-orders).
 * TransferOperation.currency defaults to the same value. Single authority for this unit.
 */
export const HISTORICAL_STOREFRONT_TRANSFER_CURRENCY = "usd" as const;

export const HISTORICAL_TO_ALLOWED_APPLY_CUTOVER_MODES = ["LEGACY", "FROZEN"] as const;
export type HistoricalToAllowedApplyCutoverMode =
  (typeof HISTORICAL_TO_ALLOWED_APPLY_CUTOVER_MODES)[number];

export type HistoricalToClassification =
  | "R1_UNAMBIGUOUS_PAID"
  | "R2_AMOUNT_OR_LEDGER_AMBIGUOUS"
  | "R3_ALREADY_REFUNDED_LEGACY"
  | "R4_DATA_INCONSISTENCY"
  | "R5_REQUIRES_PROVIDER_OR_OPERATOR"
  | "ALREADY_CANONICAL"
  | "NOT_A_LEGACY_TRANSFER_CANDIDATE";

export type HistoricalToReasonCode =
  | "LEGACY_TRANSFER_ID_PRESENT"
  | "LEGACY_TRANSFER_ID_BLANK"
  | "EXPECTED_AMOUNT_RECONSTRUCTED"
  | "EXPECTED_AMOUNT_MISSING_INPUTS"
  | "EXPECTED_AMOUNT_NON_POSITIVE"
  | "SALE_LEDGER_EXACT_ONE_AMOUNT_MATCH"
  | "SALE_LEDGER_MISSING"
  | "SALE_LEDGER_MULTIPLE"
  | "SALE_LEDGER_AMOUNT_MISMATCH"
  | "SALE_LEDGER_SELLER_MISMATCH"
  | "SALE_LEDGER_TRANSFER_ID_CONFLICT"
  | "RETURN_DEBIT_PRESENT"
  | "LEGACY_REFUND_COMPLETED_WITH_RETURN_DEBIT"
  | "REFUNDED_STATUS_WITHOUT_SETTLEMENT_EVIDENCE"
  | "EXISTING_TRANSFER_OPERATION"
  | "EXISTING_TRANSFER_OPERATION_CONFLICT"
  | "CANONICAL_KEY_COLLISION"
  | "TRANSFER_ID_OWNED_BY_OTHER_OPERATION"
  | "SELLER_ID_MISSING"
  | "ORDER_NOT_FOUND"
  | "STALE_PREVIEW_RECLASSIFIED"
  | "CUTOVER_MODE_REFUSED";

/** Expected SUCCEEDED historical TransferOperation identity for R1 / ALREADY_CANONICAL. */
export type HistoricalToExpectedCanonicalRow = {
  storeOrderId: string;
  memberId: string;
  amountCents: number;
  currency: string;
  providerIdempotencyKey: string;
  stripeTransferId: string;
  status: "SUCCEEDED";
};

/** Persisted TransferOperation fields compared for historical canonical equivalence. */
export type HistoricalToExistingRow = {
  storeOrderId: string;
  memberId: string;
  amountCents: number;
  currency: string;
  providerIdempotencyKey: string;
  stripeTransferId: string | null;
  status: string;
};

export type HistoricalSaleLedgerEvidence = {
  id: string;
  memberId: string;
  amountCents: number;
  stripeTransferId: string | null;
  createdAt: Date;
};

export type HistoricalReturnLedgerEvidence = {
  id: string;
  memberId: string;
  amountCents: number;
  createdAt: Date;
};

export type HistoricalToCandidateEvidence = {
  storeOrderId: string;
  sellerId: string | null;
  status: string | null;
  stripeSellerTransferId: string | null;
  totalCents: number | null;
  subtotalCents: number | null;
  platformFeeCents: number | null;
  salesTaxReserveCents: number | null;
  stripeRefundId: string | null;
  refundCompletedAt: Date | null;
  saleLedgers: HistoricalSaleLedgerEvidence[];
  returnDebits: HistoricalReturnLedgerEvidence[];
  existingTransferOperation: {
    id: string;
    storeOrderId: string;
    status: string;
    stripeTransferId: string | null;
    providerIdempotencyKey: string;
    memberId: string;
    amountCents: number;
    currency: string;
  } | null;
  /** Another TransferOperation already owns this provider idempotency key. */
  canonicalKeyCollision: boolean;
  /** Another TransferOperation already owns this stripe transfer id. */
  transferIdOwnedElsewhere: boolean;
};

export type HistoricalToCandidateRecord = {
  storeOrderId: string;
  memberId: string | null;
  legacyTransferId: string | null;
  legacyTransferIdMasked: string | null;
  expectedAmountCents: number | null;
  currency: typeof HISTORICAL_STOREFRONT_TRANSFER_CURRENCY;
  orderStatus: string | null;
  saleLedgerCount: number;
  saleLedgerAmountCents: number | null;
  saleLedgerCreatedAt: string | null;
  saleLedgerHasStripeTransferId: boolean;
  returnDebitCount: number;
  hasStripeRefundId: boolean;
  hasRefundCompletedAt: boolean;
  existingTransferOperationId: string | null;
  classification: HistoricalToClassification;
  reasonCodes: HistoricalToReasonCode[];
};

export type HistoricalToApplyOutcome =
  | "CREATED"
  | "ALREADY_CANONICAL"
  | "SKIPPED_NOT_R1"
  | "REFUSED_STALE"
  | "REFUSED_CUTOVER"
  | "ORDER_MISSING";

export type HistoricalToApplyItemResult = {
  storeOrderId: string;
  classification: HistoricalToClassification;
  reasonCodes: HistoricalToReasonCode[];
  outcome: HistoricalToApplyOutcome;
  createdTransferOperationId: string | null;
  preexistingTransferOperationId: string | null;
};

export type HistoricalToApplyOverallStatus =
  | "COMPLETE"
  | "PARTIAL_BLOCKED_RESIDUALS"
  | "REFUSED"
  | "NO_CANDIDATES";

export type HistoricalTransferOperationBackfillManifest = {
  manifestVersion: typeof HISTORICAL_TO_BACKFILL_MANIFEST_VERSION;
  generatedAt: string;
  engineSha: string | null;
  mode: "PREVIEW" | "APPLY";
  candidateHash: string;
  cutoverMode: string | null;
  candidateCount: number;
  counts: {
    R1_UNAMBIGUOUS_PAID: number;
    R2_AMOUNT_OR_LEDGER_AMBIGUOUS: number;
    R3_ALREADY_REFUNDED_LEGACY: number;
    R4_DATA_INCONSISTENCY: number;
    R5_REQUIRES_PROVIDER_OR_OPERATOR: number;
    ALREADY_CANONICAL: number;
    NOT_A_LEGACY_TRANSFER_CANDIDATE: number;
    created: number;
    skipped: number;
  };
  overallStatus: HistoricalToApplyOverallStatus | "PREVIEW";
  candidates: HistoricalToCandidateRecord[];
  applyResults: HistoricalToApplyItemResult[];
  conflicts: Array<{ storeOrderId: string; reasonCodes: HistoricalToReasonCode[] }>;
};
