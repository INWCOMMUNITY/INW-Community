import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { foundationTransferIdempotencyKey } from "../../commerce-foundation-transfer";
import { classifyHistoricalTransferOperationCandidate } from "./classify";
import {
  HISTORICAL_TO_BACKFILL_MANIFEST_VERSION,
  type HistoricalToCandidateEvidence,
  type HistoricalToCandidateRecord,
  type HistoricalTransferOperationBackfillManifest,
} from "./types";

type Db = Pick<
  PrismaClient,
  "storeOrder" | "transferOperation" | "sellerBalanceTransaction" | "commerceFoundationCutover"
>;

function emptyCounts(): HistoricalTransferOperationBackfillManifest["counts"] {
  return {
    R1_UNAMBIGUOUS_PAID: 0,
    R2_AMOUNT_OR_LEDGER_AMBIGUOUS: 0,
    R3_ALREADY_REFUNDED_LEGACY: 0,
    R4_DATA_INCONSISTENCY: 0,
    R5_REQUIRES_PROVIDER_OR_OPERATOR: 0,
    ALREADY_CANONICAL: 0,
    NOT_A_LEGACY_TRANSFER_CANDIDATE: 0,
    created: 0,
    skipped: 0,
  };
}

/**
 * Candidate content hash — excludes generatedAt / volatile timestamps in metadata.
 * Uses classification + order id + expected amount + masked transfer + reasons.
 */
export function hashHistoricalToCandidates(candidates: HistoricalToCandidateRecord[]): string {
  const payload = candidates
    .map((c) => ({
      storeOrderId: c.storeOrderId,
      classification: c.classification,
      expectedAmountCents: c.expectedAmountCents,
      legacyTransferId: c.legacyTransferId,
      memberId: c.memberId,
      reasonCodes: [...c.reasonCodes].sort(),
      orderStatus: c.orderStatus,
      saleLedgerCount: c.saleLedgerCount,
      returnDebitCount: c.returnDebitCount,
    }))
    .sort((a, b) => a.storeOrderId.localeCompare(b.storeOrderId));
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildHistoricalToPreviewManifest(args: {
  candidates: HistoricalToCandidateRecord[];
  engineSha?: string | null;
  cutoverMode?: string | null;
}): HistoricalTransferOperationBackfillManifest {
  const counts = emptyCounts();
  const conflicts: HistoricalTransferOperationBackfillManifest["conflicts"] = [];
  for (const c of args.candidates) {
    counts[c.classification] += 1;
    if (
      c.classification === "R3_ALREADY_REFUNDED_LEGACY" ||
      c.classification === "R4_DATA_INCONSISTENCY" ||
      c.classification === "R2_AMOUNT_OR_LEDGER_AMBIGUOUS" ||
      c.classification === "R5_REQUIRES_PROVIDER_OR_OPERATOR"
    ) {
      conflicts.push({ storeOrderId: c.storeOrderId, reasonCodes: c.reasonCodes });
    }
  }
  return {
    manifestVersion: HISTORICAL_TO_BACKFILL_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    engineSha: args.engineSha ?? null,
    mode: "PREVIEW",
    candidateHash: hashHistoricalToCandidates(args.candidates),
    cutoverMode: args.cutoverMode ?? null,
    candidateCount: args.candidates.length,
    counts,
    overallStatus: "PREVIEW",
    candidates: args.candidates,
    applyResults: [],
    conflicts,
  };
}

export async function loadHistoricalToCandidateEvidence(
  db: Db,
  storeOrderId: string
): Promise<HistoricalToCandidateEvidence> {
  const order = await db.storeOrder.findUnique({
    where: { id: storeOrderId },
    select: {
      id: true,
      sellerId: true,
      status: true,
      stripeSellerTransferId: true,
      totalCents: true,
      subtotalCents: true,
      platformFeeCents: true,
      salesTaxReserveCents: true,
      stripeRefundId: true,
      refundCompletedAt: true,
    },
  });

  if (!order) {
    return {
      storeOrderId,
      sellerId: null,
      status: null,
      stripeSellerTransferId: null,
      totalCents: null,
      subtotalCents: null,
      platformFeeCents: null,
      salesTaxReserveCents: null,
      stripeRefundId: null,
      refundCompletedAt: null,
      saleLedgers: [],
      returnDebits: [],
      existingTransferOperation: null,
      canonicalKeyCollision: false,
      transferIdOwnedElsewhere: false,
    };
  }

  const [existingTo, saleLedgers, returnRows] = await Promise.all([
    db.transferOperation.findUnique({
      where: { storeOrderId },
      select: {
        id: true,
        storeOrderId: true,
        status: true,
        stripeTransferId: true,
        providerIdempotencyKey: true,
        memberId: true,
        amountCents: true,
        currency: true,
      },
    }),
    db.sellerBalanceTransaction.findMany({
      where: { orderId: storeOrderId, type: "sale" },
      select: {
        id: true,
        memberId: true,
        amountCents: true,
        stripeTransferId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    db.sellerBalanceTransaction.findMany({
      where: { orderId: storeOrderId, type: "return", amountCents: { lt: 0 } },
      select: {
        id: true,
        memberId: true,
        amountCents: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const legacyId = order.stripeSellerTransferId?.trim() || null;
  const expectedKey = foundationTransferIdempotencyKey(storeOrderId);

  const [keyOwner, transferOwner] = await Promise.all([
    db.transferOperation.findUnique({
      where: { providerIdempotencyKey: expectedKey },
      select: { id: true, storeOrderId: true },
    }),
    legacyId
      ? db.transferOperation.findUnique({
          where: { stripeTransferId: legacyId },
          select: { id: true, storeOrderId: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    storeOrderId: order.id,
    sellerId: order.sellerId,
    status: order.status,
    stripeSellerTransferId: order.stripeSellerTransferId,
    totalCents: order.totalCents,
    subtotalCents: order.subtotalCents,
    platformFeeCents: order.platformFeeCents,
    salesTaxReserveCents: order.salesTaxReserveCents,
    stripeRefundId: order.stripeRefundId,
    refundCompletedAt: order.refundCompletedAt,
    saleLedgers,
    returnDebits: returnRows,
    existingTransferOperation: existingTo,
    canonicalKeyCollision: Boolean(keyOwner && keyOwner.storeOrderId !== storeOrderId),
    transferIdOwnedElsewhere: Boolean(transferOwner && transferOwner.storeOrderId !== storeOrderId),
  };
}

export type AnalyzeHistoricalToBackfillInput = {
  /** When omitted, scans all StoreOrders with non-null stripeSellerTransferId. */
  storeOrderIds?: string[];
  engineSha?: string | null;
};

/**
 * Read-only preview analyzer. No mutation.
 */
export async function analyzeHistoricalTransferOperationBackfill(
  db: Db,
  input: AnalyzeHistoricalToBackfillInput = {}
): Promise<HistoricalTransferOperationBackfillManifest> {
  let orderIds = input.storeOrderIds;
  if (!orderIds || orderIds.length === 0) {
    const rows = await db.storeOrder.findMany({
      where: { stripeSellerTransferId: { not: null } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    orderIds = rows.map((r) => r.id);
  }

  const cutover = await db.commerceFoundationCutover.findUnique({
    where: { id: "singleton" },
    select: { mode: true },
  });

  const candidates: HistoricalToCandidateRecord[] = [];
  for (const id of orderIds) {
    const evidence = await loadHistoricalToCandidateEvidence(db, id);
    // Skip pure non-candidates when scanning all legacy-transfer orders that somehow blanked
    const record = classifyHistoricalTransferOperationCandidate(evidence);
    if (
      record.classification === "NOT_A_LEGACY_TRANSFER_CANDIDATE" &&
      input.storeOrderIds == null
    ) {
      continue;
    }
    if (evidence.status === null && evidence.sellerId === null) {
      candidates.push({
        ...record,
        classification: "R5_REQUIRES_PROVIDER_OR_OPERATOR",
        reasonCodes: ["ORDER_NOT_FOUND"],
      });
      continue;
    }
    candidates.push(record);
  }

  return buildHistoricalToPreviewManifest({
    candidates,
    engineSha: input.engineSha,
    cutoverMode: cutover?.mode ?? null,
  });
}
