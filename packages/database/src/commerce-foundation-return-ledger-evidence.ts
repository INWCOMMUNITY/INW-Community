/**
 * Unit 5C: pure classification of SellerBalanceTransaction evidence for
 * type="return" and type="return_entitlement".
 * No DB writes. No provider calls. No economic formula duplication.
 */

export const FOUNDATION_RETURN_LEDGER_TYPE = "return";

export type FoundationReturnLedgerEvidenceClassification =
  | "NONE_EXPECTED"
  | "MISSING"
  | "EXACT"
  | "DUPLICATE_EXACT"
  | "EXACT_PLUS_CONFLICT"
  | "CONFLICT_ONLY";

export type FoundationReturnLedgerEvidenceRow = {
  id: string;
  memberId: string;
  orderId: string | null;
  type: string;
  amountCents: number;
  stripeTransferId?: string | null;
};

export type FoundationReturnLedgerExactExpectation =
  | { expected: false }
  | {
      expected: true;
      memberId: string;
      /** Signed ledger amount (Path-A debit is negative; entitlement credit is positive). */
      amountCents: number;
      /** When true, stripeTransferId on each row must equal expectedStripeTransferId (null-safe). */
      matchStripeTransferId: boolean;
      expectedStripeTransferId?: string | null;
    };

export type FoundationReturnLedgerEvidenceResult = {
  classification: FoundationReturnLedgerEvidenceClassification;
  rowCount: number;
  exactCount: number;
  conflictCount: number;
  exactRowIds: string[];
  conflictRowIds: string[];
};

export function isFoundationReturnLedgerAnomaly(
  classification: FoundationReturnLedgerEvidenceClassification
): boolean {
  return (
    classification === "DUPLICATE_EXACT" ||
    classification === "EXACT_PLUS_CONFLICT" ||
    classification === "CONFLICT_ONLY"
  );
}

function rowMatchesExact(
  row: FoundationReturnLedgerEvidenceRow,
  expected: Extract<FoundationReturnLedgerExactExpectation, { expected: true }>
): boolean {
  if (row.memberId !== expected.memberId) return false;
  if (row.amountCents !== expected.amountCents) return false;
  if (expected.matchStripeTransferId) {
    const got = row.stripeTransferId ?? null;
    const want = expected.expectedStripeTransferId ?? null;
    if (got !== want) return false;
  }
  return true;
}

/**
 * Classify all ledger rows already filtered to one orderId + one type.
 */
export function classifySellerBalanceLedgerEvidence(args: {
  expected: FoundationReturnLedgerExactExpectation;
  rows: FoundationReturnLedgerEvidenceRow[];
}): FoundationReturnLedgerEvidenceResult {
  const rows = args.rows;
  const rowCount = rows.length;

  if (!args.expected.expected) {
    if (rowCount === 0) {
      return {
        classification: "NONE_EXPECTED",
        rowCount: 0,
        exactCount: 0,
        conflictCount: 0,
        exactRowIds: [],
        conflictRowIds: [],
      };
    }
    return {
      classification: "CONFLICT_ONLY",
      rowCount,
      exactCount: 0,
      conflictCount: rowCount,
      exactRowIds: [],
      conflictRowIds: rows.map((r) => r.id),
    };
  }

  const exactRowIds: string[] = [];
  const conflictRowIds: string[] = [];
  for (const row of rows) {
    if (rowMatchesExact(row, args.expected)) exactRowIds.push(row.id);
    else conflictRowIds.push(row.id);
  }
  const exactCount = exactRowIds.length;
  const conflictCount = conflictRowIds.length;

  if (rowCount === 0) {
    return {
      classification: "MISSING",
      rowCount: 0,
      exactCount: 0,
      conflictCount: 0,
      exactRowIds: [],
      conflictRowIds: [],
    };
  }
  if (exactCount >= 1 && conflictCount >= 1) {
    return {
      classification: "EXACT_PLUS_CONFLICT",
      rowCount,
      exactCount,
      conflictCount,
      exactRowIds,
      conflictRowIds,
    };
  }
  if (exactCount === 0) {
    return {
      classification: "CONFLICT_ONLY",
      rowCount,
      exactCount: 0,
      conflictCount,
      exactRowIds: [],
      conflictRowIds,
    };
  }
  if (exactCount === 1) {
    return {
      classification: "EXACT",
      rowCount,
      exactCount: 1,
      conflictCount: 0,
      exactRowIds,
      conflictRowIds: [],
    };
  }
  return {
    classification: "DUPLICATE_EXACT",
    rowCount,
    exactCount,
    conflictCount: 0,
    exactRowIds,
    conflictRowIds: [],
  };
}
