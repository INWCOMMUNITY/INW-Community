import {
  FOUNDATION_RETURN_ENTITLEMENT_LEDGER_TYPE,
  FOUNDATION_RETURN_LEDGER_TYPE,
  classifySellerBalanceLedgerEvidence,
  isFoundationReturnLedgerAnomaly,
  prisma,
  type FoundationReturnLedgerEvidenceClassification,
  type FoundationReturnLedgerEvidenceResult,
} from "database";
import { originalSaleTransferCentsFromOrder } from "@/lib/store-return-settlement";
import { sellerTransferReversalCents } from "@/lib/store-return";

export type FoundationReturnLedgerAdminRow = {
  id: string;
  memberId: string;
  orderId: string | null;
  type: string;
  amountCents: number;
  stripeTransferId: string | null;
  createdAt: Date;
  description: string | null;
};

export type FoundationReturnLedgerSideAdminState = {
  expected: boolean;
  expectedAmountCents: number | null;
  expectedStripeTransferId?: string | null;
  entitlementOperationId?: string | null;
  classification: FoundationReturnLedgerEvidenceClassification;
  rowCount: number;
  exactCount: number;
  conflictCount: number;
  exactRowIds: string[];
  conflictRowIds: string[];
  rows: FoundationReturnLedgerAdminRow[];
};

export type FoundationReturnLedgerAdminState = {
  storeOrderId: string;
  sellerId: string;
  returnLedger: FoundationReturnLedgerSideAdminState;
  returnEntitlementLedger: FoundationReturnLedgerSideAdminState;
  hasLedgerAnomaly: boolean;
};

function toAdminRows(
  rows: Array<{
    id: string;
    memberId: string;
    orderId: string | null;
    type: string;
    amountCents: number;
    stripeTransferId: string | null;
    createdAt: Date;
    description: string | null;
  }>
): FoundationReturnLedgerAdminRow[] {
  return rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    orderId: row.orderId,
    type: row.type,
    amountCents: row.amountCents,
    stripeTransferId: row.stripeTransferId,
    createdAt: row.createdAt,
    description: row.description,
  }));
}

function sideFromEvidence(
  evidence: FoundationReturnLedgerEvidenceResult,
  rows: FoundationReturnLedgerAdminRow[],
  extras: {
    expected: boolean;
    expectedAmountCents: number | null;
    expectedStripeTransferId?: string | null;
    entitlementOperationId?: string | null;
  }
): FoundationReturnLedgerSideAdminState {
  return {
    expected: extras.expected,
    expectedAmountCents: extras.expectedAmountCents,
    expectedStripeTransferId: extras.expectedStripeTransferId,
    entitlementOperationId: extras.entitlementOperationId,
    classification: evidence.classification,
    rowCount: evidence.rowCount,
    exactCount: evidence.exactCount,
    conflictCount: evidence.conflictCount,
    exactRowIds: evidence.exactRowIds,
    conflictRowIds: evidence.conflictRowIds,
    rows,
  };
}

/**
 * Admin read-only dual ledger evidence for Path-A return debit and return_entitlement credit.
 * Reuses canonical sale/reversal helpers; never writes or calls Stripe.
 */
export async function getFoundationReturnLedgerAdminState(args: {
  storeOrderId: string;
}): Promise<FoundationReturnLedgerAdminState | null> {
  const order = await prisma.storeOrder.findUnique({
    where: { id: args.storeOrderId },
    select: {
      id: true,
      sellerId: true,
      totalCents: true,
      subtotalCents: true,
    },
  });
  if (!order) return null;

  const [storeReturn, transfer, entitlement, returnRows, entitlementRows] = await Promise.all([
    prisma.storeReturn.findFirst({
      where: { orderId: order.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        chargeReturnShipping: true,
        returnLabelCostCents: true,
      },
    }),
    prisma.transferOperation.findUnique({
      where: { storeOrderId: order.id },
      select: { status: true, stripeTransferId: true },
    }),
    prisma.sellerReturnEntitlementOperation.findUnique({
      where: { storeOrderId: order.id },
    }),
    prisma.sellerBalanceTransaction.findMany({
      where: { orderId: order.id, type: FOUNDATION_RETURN_LEDGER_TYPE },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.sellerBalanceTransaction.findMany({
      where: { orderId: order.id, type: FOUNDATION_RETURN_ENTITLEMENT_LEDGER_TYPE },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);

  const originalSaleTransferCents = originalSaleTransferCentsFromOrder(order);
  const pathAReversalCents =
    transfer?.status === "SUCCEEDED" && transfer.stripeTransferId
      ? sellerTransferReversalCents({
          originalTransferCents: originalSaleTransferCents,
          chargeReturnShipping: storeReturn?.chargeReturnShipping ?? false,
          returnLabelCostCents: storeReturn?.returnLabelCostCents,
        })
      : 0;

  const returnEvidence =
    pathAReversalCents > 0
      ? classifySellerBalanceLedgerEvidence({
          expected: {
            expected: true,
            memberId: order.sellerId,
            amountCents: -pathAReversalCents,
            matchStripeTransferId: false,
          },
          rows: returnRows,
        })
      : classifySellerBalanceLedgerEvidence({
          expected: { expected: false },
          rows: returnRows,
        });

  const entitlementDurable =
    entitlement?.status === "SUCCEEDED" &&
    Boolean(entitlement.stripeTransferId?.trim()) &&
    entitlement.amountCents > 0;

  const entitlementEvidence = entitlementDurable
    ? classifySellerBalanceLedgerEvidence({
        expected: {
          expected: true,
          memberId: entitlement!.memberId,
          amountCents: entitlement!.amountCents,
          matchStripeTransferId: true,
          expectedStripeTransferId: entitlement!.stripeTransferId,
        },
        rows: entitlementRows,
      })
    : classifySellerBalanceLedgerEvidence({
        expected: { expected: false },
        rows: entitlementRows,
      });

  const returnLedger = sideFromEvidence(returnEvidence, toAdminRows(returnRows), {
    expected: pathAReversalCents > 0,
    expectedAmountCents: pathAReversalCents > 0 ? -pathAReversalCents : null,
  });

  const returnEntitlementLedger = sideFromEvidence(
    entitlementEvidence,
    toAdminRows(entitlementRows),
    {
      expected: Boolean(entitlementDurable),
      expectedAmountCents: entitlementDurable ? entitlement!.amountCents : null,
      expectedStripeTransferId: entitlementDurable ? entitlement!.stripeTransferId : null,
      entitlementOperationId: entitlement?.id ?? null,
    }
  );

  return {
    storeOrderId: order.id,
    sellerId: order.sellerId,
    returnLedger,
    returnEntitlementLedger,
    hasLedgerAnomaly:
      isFoundationReturnLedgerAnomaly(returnEvidence.classification) ||
      isFoundationReturnLedgerAnomaly(entitlementEvidence.classification),
  };
}
