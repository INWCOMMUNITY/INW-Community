/**
 * R3 historical already-refunded compatibility — pure evidence + taxonomy.
 * Recognizes durable legacy settlement; never invents provider IDs or moves money.
 */

export type HistoricalRefundCompatibilityClassification =
  | "HISTORICAL_REFUND_ALREADY_SETTLED"
  | "HISTORICAL_REFUND_AMBIGUOUS"
  | "HISTORICAL_REFUND_ANOMALY"
  | "NOT_HISTORICAL_LEGACY_REFUND";

export type HistoricalRefundCompatibilityReasonCode =
  | "LEGACY_TRANSFER_ID_PRESENT"
  | "LEGACY_TRANSFER_ID_MISSING"
  | "SELLER_IDENTITY_MISSING"
  | "EXPECTED_AMOUNT_RECONSTRUCTED"
  | "EXPECTED_AMOUNT_MISSING_INPUTS"
  | "EXPECTED_AMOUNT_NON_POSITIVE"
  | "SALE_LEDGER_EXACT_ONE"
  | "SALE_LEDGER_MISSING"
  | "SALE_LEDGER_DUPLICATE"
  | "SALE_LEDGER_SELLER_MISMATCH"
  | "SALE_LEDGER_AMOUNT_MISMATCH"
  | "ORDER_STATUS_REFUNDED"
  | "ORDER_STATUS_NOT_REFUNDED"
  | "REFUND_COMPLETION_PRESENT"
  | "REFUND_NOT_COMPLETED"
  | "RETURN_DEBIT_EXACT_ONE"
  | "RETURN_DEBIT_MISSING"
  | "RETURN_DEBIT_DUPLICATE"
  | "RETURN_DEBIT_SELLER_MISMATCH"
  | "RETURN_DEBIT_AMOUNT_MISMATCH"
  | "TRANSFER_OPERATION_ABSENT"
  | "TRANSFER_OPERATION_PRESENT"
  | "FOUNDATION_REFUND_OPERATION_ABSENT"
  | "FOUNDATION_REFUND_OPERATION_PRESENT"
  | "FOUNDATION_ENTITLEMENT_OPERATION_ABSENT"
  | "FOUNDATION_ENTITLEMENT_OPERATION_PRESENT"
  | "HISTORICAL_REFUND_ALREADY_SETTLED";

export type HistoricalRefundLedgerRow = {
  id: string;
  memberId: string;
  type: string;
  amountCents: number;
  orderId: string | null;
  stripeTransferId: string | null;
  createdAt: Date;
};

export type HistoricalRefundTransferOperationEvidence = {
  id: string;
  status: string;
  stripeTransferId: string | null;
  amountCents: number;
  memberId: string;
};

export type HistoricalRefundCompatibilityEvidence = {
  storeOrderId: string;
  sellerId: string | null;
  status: string | null;
  stripeSellerTransferId: string | null;
  stripeRefundId: string | null;
  refundCompletedAt: Date | null;
  totalCents: number | null;
  platformFeeCents: number | null;
  salesTaxReserveCents: number | null;
  saleLedgers: HistoricalRefundLedgerRow[];
  returnDebits: HistoricalRefundLedgerRow[];
  transferOperation: HistoricalRefundTransferOperationEvidence | null;
  refundOperationCount: number;
  sellerReturnEntitlementOperationCount: number;
};

export type HistoricalRefundCompatibilityRecord = {
  storeOrderId: string;
  sellerId: string | null;
  classification: HistoricalRefundCompatibilityClassification;
  reasonCodes: HistoricalRefundCompatibilityReasonCode[];
  expectedSellerTransferCents: number | null;
  orderStatus: string | null;
  legacyTransferIdMasked: string | null;
  hasStripeRefundId: boolean;
  hasRefundCompletedAt: boolean;
  saleLedgerCount: number;
  saleLedgerAmountCents: number | null;
  returnDebitCount: number;
  returnDebitAmountCents: number | null;
  hasTransferOperation: boolean;
  transferOperationStatus: string | null;
  refundOperationCount: number;
  sellerReturnEntitlementOperationCount: number;
};

export const HISTORICAL_REFUND_COMPATIBILITY_MANIFEST_VERSION = "historical-refund-compatibility-v1";

export type HistoricalRefundCompatibilityManifest = {
  manifestVersion: string;
  generatedAt: string;
  evidenceHash: string;
  candidateCount: number;
  counts: Record<HistoricalRefundCompatibilityClassification, number>;
  candidates: HistoricalRefundCompatibilityRecord[];
};
