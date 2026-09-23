import { describe, expect, it } from "vitest";
import {
  classifySellerBalanceLedgerEvidence,
  isFoundationReturnLedgerAnomaly,
} from "../commerce-foundation-return-ledger-evidence";

function row(
  id: string,
  overrides: Partial<{
    memberId: string;
    orderId: string | null;
    type: string;
    amountCents: number;
    stripeTransferId: string | null;
  }> = {}
) {
  return {
    id,
    memberId: overrides.memberId ?? "seller-1",
    orderId: overrides.orderId ?? "ord-1",
    type: overrides.type ?? "return",
    amountCents: overrides.amountCents ?? -9900,
    stripeTransferId: overrides.stripeTransferId ?? null,
  };
}

describe("classifySellerBalanceLedgerEvidence (Unit 5C pure)", () => {
  const expectedReturn = {
    expected: true as const,
    memberId: "seller-1",
    amountCents: -9900,
    matchStripeTransferId: false,
  };
  const expectedEntitlement = {
    expected: true as const,
    memberId: "seller-1",
    amountCents: 1000,
    matchStripeTransferId: true,
    expectedStripeTransferId: "tr_1",
  };

  for (const label of ["return", "return_entitlement"] as const) {
    const expected = label === "return" ? expectedReturn : expectedEntitlement;
    const make = (id: string, ok = true) =>
      label === "return"
        ? row(id, ok ? {} : { amountCents: -1 })
        : row(id, {
            type: "return_entitlement",
            amountCents: ok ? 1000 : 50,
            stripeTransferId: ok ? "tr_1" : "tr_other",
          });

    it(`${label}: expected-none + 0 rows → NONE_EXPECTED`, () => {
      const result = classifySellerBalanceLedgerEvidence({
        expected: { expected: false },
        rows: [],
      });
      expect(result.classification).toBe("NONE_EXPECTED");
      expect(isFoundationReturnLedgerAnomaly(result.classification)).toBe(false);
    });

    it(`${label}: expected-one + 0 rows → MISSING`, () => {
      const result = classifySellerBalanceLedgerEvidence({ expected, rows: [] });
      expect(result.classification).toBe("MISSING");
      expect(isFoundationReturnLedgerAnomaly(result.classification)).toBe(false);
    });

    it(`${label}: one exact → EXACT`, () => {
      const result = classifySellerBalanceLedgerEvidence({ expected, rows: [make("a")] });
      expect(result).toMatchObject({
        classification: "EXACT",
        rowCount: 1,
        exactCount: 1,
        conflictCount: 0,
        exactRowIds: ["a"],
      });
    });

    it(`${label}: two exact → DUPLICATE_EXACT`, () => {
      const result = classifySellerBalanceLedgerEvidence({
        expected,
        rows: [make("a"), make("b")],
      });
      expect(result.classification).toBe("DUPLICATE_EXACT");
      expect(result.exactCount).toBe(2);
      expect(result.exactRowIds).toEqual(["a", "b"]);
      expect(isFoundationReturnLedgerAnomaly(result.classification)).toBe(true);
    });

    it(`${label}: exact + conflict → EXACT_PLUS_CONFLICT`, () => {
      const result = classifySellerBalanceLedgerEvidence({
        expected,
        rows: [make("a"), make("b", false)],
      });
      expect(result.classification).toBe("EXACT_PLUS_CONFLICT");
      expect(result.exactRowIds).toEqual(["a"]);
      expect(result.conflictRowIds).toEqual(["b"]);
    });

    it(`${label}: one conflict → CONFLICT_ONLY`, () => {
      const result = classifySellerBalanceLedgerEvidence({
        expected,
        rows: [make("bad", false)],
      });
      expect(result.classification).toBe("CONFLICT_ONLY");
      expect(result.conflictCount).toBe(1);
    });

    it(`${label}: multiple conflicts → CONFLICT_ONLY`, () => {
      const result = classifySellerBalanceLedgerEvidence({
        expected,
        rows: [make("b1", false), make("b2", false)],
      });
      expect(result.classification).toBe("CONFLICT_ONLY");
      expect(result.conflictCount).toBe(2);
    });

    it(`${label}: expected-none + any rows → CONFLICT_ONLY`, () => {
      const result = classifySellerBalanceLedgerEvidence({
        expected: { expected: false },
        rows: [make("stray")],
      });
      expect(result.classification).toBe("CONFLICT_ONLY");
      expect(result.conflictRowIds).toEqual(["stray"]);
    });
  }
});
