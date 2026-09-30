import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { classifyHistoricalRefundCompatibility, isHistoricalRefundAlreadySettled } from "./classify";
import type {
  HistoricalRefundCompatibilityEvidence,
  HistoricalRefundCompatibilityManifest,
  HistoricalRefundCompatibilityRecord,
  HistoricalRefundLedgerRow,
} from "./types";
import { HISTORICAL_REFUND_COMPATIBILITY_MANIFEST_VERSION } from "./types";

type EvidenceDb = {
  storeOrder: PrismaClient["storeOrder"];
  sellerBalanceTransaction: PrismaClient["sellerBalanceTransaction"];
  transferOperation: PrismaClient["transferOperation"];
  refundOperation: PrismaClient["refundOperation"];
  sellerReturnEntitlementOperation: PrismaClient["sellerReturnEntitlementOperation"];
};

function emptyCounts(): HistoricalRefundCompatibilityManifest["counts"] {
  return {
    HISTORICAL_REFUND_ALREADY_SETTLED: 0,
    HISTORICAL_REFUND_AMBIGUOUS: 0,
    HISTORICAL_REFUND_ANOMALY: 0,
    NOT_HISTORICAL_LEGACY_REFUND: 0,
  };
}

function mapLedger(row: {
  id: string;
  memberId: string;
  type: string;
  amountCents: number;
  orderId: string | null;
  stripeTransferId: string | null;
  createdAt: Date;
}): HistoricalRefundLedgerRow {
  return {
    id: row.id,
    memberId: row.memberId,
    type: row.type,
    amountCents: row.amountCents,
    orderId: row.orderId,
    stripeTransferId: row.stripeTransferId,
    createdAt: row.createdAt,
  };
}

export async function loadHistoricalRefundCompatibilityEvidence(
  db: EvidenceDb,
  storeOrderId: string
): Promise<HistoricalRefundCompatibilityEvidence> {
  const order = await db.storeOrder.findUnique({
    where: { id: storeOrderId },
    select: {
      id: true,
      sellerId: true,
      status: true,
      stripeSellerTransferId: true,
      stripeRefundId: true,
      refundCompletedAt: true,
      totalCents: true,
      platformFeeCents: true,
      salesTaxReserveCents: true,
    },
  });

  if (!order) {
    return {
      storeOrderId,
      sellerId: null,
      status: null,
      stripeSellerTransferId: null,
      stripeRefundId: null,
      refundCompletedAt: null,
      totalCents: null,
      platformFeeCents: null,
      salesTaxReserveCents: null,
      saleLedgers: [],
      returnDebits: [],
      transferOperation: null,
      refundOperationCount: 0,
      sellerReturnEntitlementOperationCount: 0,
    };
  }

  const [saleLedgers, returnDebits, transferOperation, refundOperationCount, entitlementCount] =
    await Promise.all([
      db.sellerBalanceTransaction.findMany({
        where: { orderId: storeOrderId, type: "sale" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          memberId: true,
          type: true,
          amountCents: true,
          orderId: true,
          stripeTransferId: true,
          createdAt: true,
        },
      }),
      db.sellerBalanceTransaction.findMany({
        where: { orderId: storeOrderId, type: "return", amountCents: { lt: 0 } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          memberId: true,
          type: true,
          amountCents: true,
          orderId: true,
          stripeTransferId: true,
          createdAt: true,
        },
      }),
      db.transferOperation.findUnique({
        where: { storeOrderId },
        select: {
          id: true,
          status: true,
          stripeTransferId: true,
          amountCents: true,
          memberId: true,
        },
      }),
      db.refundOperation.count({ where: { storeOrderId } }),
      db.sellerReturnEntitlementOperation.count({ where: { storeOrderId } }),
    ]);

  return {
    storeOrderId: order.id,
    sellerId: order.sellerId,
    status: order.status,
    stripeSellerTransferId: order.stripeSellerTransferId,
    stripeRefundId: order.stripeRefundId,
    refundCompletedAt: order.refundCompletedAt,
    totalCents: order.totalCents,
    platformFeeCents: order.platformFeeCents,
    salesTaxReserveCents: order.salesTaxReserveCents,
    saleLedgers: saleLedgers.map(mapLedger),
    returnDebits: returnDebits.map(mapLedger),
    transferOperation: transferOperation
      ? {
          id: transferOperation.id,
          status: transferOperation.status,
          stripeTransferId: transferOperation.stripeTransferId,
          amountCents: transferOperation.amountCents,
          memberId: transferOperation.memberId,
        }
      : null,
    refundOperationCount,
    sellerReturnEntitlementOperationCount: entitlementCount,
  };
}

export function hashHistoricalRefundCompatibilityRecords(
  records: HistoricalRefundCompatibilityRecord[]
): string {
  const payload = records
    .map((c) => ({
      storeOrderId: c.storeOrderId,
      sellerId: c.sellerId,
      classification: c.classification,
      expectedSellerTransferCents: c.expectedSellerTransferCents,
      legacyTransferIdMasked: c.legacyTransferIdMasked,
      hasStripeRefundId: c.hasStripeRefundId,
      hasRefundCompletedAt: c.hasRefundCompletedAt,
      saleLedgerCount: c.saleLedgerCount,
      saleLedgerAmountCents: c.saleLedgerAmountCents,
      returnDebitCount: c.returnDebitCount,
      returnDebitAmountCents: c.returnDebitAmountCents,
      hasTransferOperation: c.hasTransferOperation,
      transferOperationStatus: c.transferOperationStatus,
      refundOperationCount: c.refundOperationCount,
      sellerReturnEntitlementOperationCount: c.sellerReturnEntitlementOperationCount,
      reasonCodes: [...c.reasonCodes].sort(),
    }))
    .sort((a, b) => a.storeOrderId.localeCompare(b.storeOrderId));
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * READ-ONLY activation preview for an explicit allowlist of StoreOrder IDs.
 * No mutation. No provider calls.
 */
export async function analyzeHistoricalRefundCompatibility(
  db: EvidenceDb,
  args: { storeOrderIds: string[] }
): Promise<HistoricalRefundCompatibilityManifest> {
  const ids = [...new Set(args.storeOrderIds.filter(Boolean))].sort();
  const candidates: HistoricalRefundCompatibilityRecord[] = [];
  for (const id of ids) {
    const evidence = await loadHistoricalRefundCompatibilityEvidence(db, id);
    candidates.push(classifyHistoricalRefundCompatibility(evidence));
  }
  const counts = emptyCounts();
  for (const c of candidates) counts[c.classification] += 1;
  return {
    manifestVersion: HISTORICAL_REFUND_COMPATIBILITY_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    evidenceHash: hashHistoricalRefundCompatibilityRecords(candidates),
    candidateCount: candidates.length,
    counts,
    candidates,
  };
}

export async function evaluateHistoricalRefundAlreadySettled(
  db: EvidenceDb,
  storeOrderId: string
): Promise<HistoricalRefundCompatibilityRecord> {
  const evidence = await loadHistoricalRefundCompatibilityEvidence(db, storeOrderId);
  return classifyHistoricalRefundCompatibility(evidence);
}

export { isHistoricalRefundAlreadySettled };
