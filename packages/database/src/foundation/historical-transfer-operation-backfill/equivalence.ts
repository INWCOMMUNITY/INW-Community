import { foundationTransferIdempotencyKey } from "../../commerce-foundation-transfer";
import {
  canReconstructHistoricalSellerTransferCents,
  reconstructHistoricalSellerTransferCents,
} from "./amount";
import {
  HISTORICAL_STOREFRONT_TRANSFER_CURRENCY,
  type HistoricalToCandidateEvidence,
  type HistoricalToExpectedCanonicalRow,
  type HistoricalToExistingRow,
} from "./types";

/**
 * Exact historical TO equivalence — single source of truth for ALREADY_CANONICAL
 * (classifier path and P2002 recovery). Only SUCCEEDED + full identity match qualifies.
 */
export function isExactHistoricalTransferOperationMatch(
  existing: HistoricalToExistingRow,
  expected: HistoricalToExpectedCanonicalRow
): boolean {
  return (
    existing.storeOrderId === expected.storeOrderId &&
    existing.memberId === expected.memberId &&
    existing.amountCents === expected.amountCents &&
    existing.currency === expected.currency &&
    existing.providerIdempotencyKey === expected.providerIdempotencyKey &&
    existing.stripeTransferId === expected.stripeTransferId &&
    existing.status === "SUCCEEDED"
  );
}

/**
 * Build the expected R1 SUCCEEDED TransferOperation from durable order evidence.
 * Returns null when identity/economics cannot be reconstructed safely.
 */
export function buildExpectedHistoricalTransferOperation(
  evidence: HistoricalToCandidateEvidence
): HistoricalToExpectedCanonicalRow | null {
  const legacyId = evidence.stripeSellerTransferId?.trim() || null;
  if (!legacyId) return null;
  if (!evidence.sellerId || evidence.sellerId.trim() === "") return null;
  if (!canReconstructHistoricalSellerTransferCents(evidence)) return null;
  const amountCents = reconstructHistoricalSellerTransferCents({
    totalCents: evidence.totalCents!,
    platformFeeCents: evidence.platformFeeCents!,
    salesTaxReserveCents: evidence.salesTaxReserveCents!,
  });
  if (amountCents <= 0) return null;
  return {
    storeOrderId: evidence.storeOrderId,
    memberId: evidence.sellerId,
    amountCents,
    currency: HISTORICAL_STOREFRONT_TRANSFER_CURRENCY,
    providerIdempotencyKey: foundationTransferIdempotencyKey(evidence.storeOrderId),
    stripeTransferId: legacyId,
    status: "SUCCEEDED",
  };
}

export function existingTransferOperationAsRow(
  op: NonNullable<HistoricalToCandidateEvidence["existingTransferOperation"]>
): HistoricalToExistingRow {
  return {
    storeOrderId: op.storeOrderId,
    memberId: op.memberId,
    amountCents: op.amountCents,
    currency: op.currency,
    providerIdempotencyKey: op.providerIdempotencyKey,
    stripeTransferId: op.stripeTransferId,
    status: op.status,
  };
}
