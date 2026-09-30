import type { Prisma, PrismaClient, TransferOperation } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { getCommerceFoundationCutoverState } from "../../commerce-foundation-cutover";
import { foundationTransferIdempotencyKey } from "../../commerce-foundation-transfer";
import {
  buildHistoricalToPreviewManifest,
  hashHistoricalToCandidates,
  loadHistoricalToCandidateEvidence,
} from "./analyze";
import { classifyHistoricalTransferOperationCandidate } from "./classify";
import { isExactHistoricalTransferOperationMatch } from "./equivalence";
import {
  HISTORICAL_STOREFRONT_TRANSFER_CURRENCY,
  HISTORICAL_TO_ALLOWED_APPLY_CUTOVER_MODES,
  HISTORICAL_TO_BACKFILL_MANIFEST_VERSION,
  type HistoricalToAllowedApplyCutoverMode,
  type HistoricalToApplyItemResult,
  type HistoricalToApplyOverallStatus,
  type HistoricalToCandidateRecord,
  type HistoricalTransferOperationBackfillManifest,
} from "./types";

type ApplyDb = PrismaClient;

async function lockStoreOrderForUpdate(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT 1 FROM "StoreOrder" WHERE "id" = ${id} FOR UPDATE`;
}

function isAllowedCutover(mode: string): mode is HistoricalToAllowedApplyCutoverMode {
  return (HISTORICAL_TO_ALLOWED_APPLY_CUTOVER_MODES as readonly string[]).includes(mode);
}

export type ApplyHistoricalToBackfillInput = {
  /** Explicit order IDs only — never silent full-table mutate. */
  storeOrderIds: string[];
  engineSha?: string | null;
  /** Optional: refuse if preview candidate hash differs. */
  expectedCandidateHash?: string | null;
  allowedCutoverModes?: readonly HistoricalToAllowedApplyCutoverMode[];
};

export type ApplyHistoricalToBackfillResult = {
  manifest: HistoricalTransferOperationBackfillManifest;
  createdTransferOperations: TransferOperation[];
};

/**
 * Mutating apply. Creates R1 TransferOperation rows only.
 * Does NOT call Stripe, ledger helpers, refund, entitlement, or StoreOrder updates.
 */
export async function applyHistoricalTransferOperationBackfill(
  prisma: ApplyDb,
  input: ApplyHistoricalToBackfillInput
): Promise<ApplyHistoricalToBackfillResult> {
  const orderIds = [...new Set(input.storeOrderIds.filter(Boolean))];
  if (orderIds.length === 0) {
    const empty = buildHistoricalToPreviewManifest({ candidates: [], engineSha: input.engineSha });
    return {
      manifest: {
        ...empty,
        mode: "APPLY",
        overallStatus: "NO_CANDIDATES",
      },
      createdTransferOperations: [],
    };
  }

  const cutover = await getCommerceFoundationCutoverState(prisma);
  const allowed = input.allowedCutoverModes ?? HISTORICAL_TO_ALLOWED_APPLY_CUTOVER_MODES;
  if (!isAllowedCutover(cutover.mode) || !allowed.includes(cutover.mode as HistoricalToAllowedApplyCutoverMode)) {
    const previewCandidates: HistoricalToCandidateRecord[] = [];
    for (const id of orderIds) {
      const evidence = await loadHistoricalToCandidateEvidence(prisma, id);
      previewCandidates.push(classifyHistoricalTransferOperationCandidate(evidence));
    }
    const base = buildHistoricalToPreviewManifest({
      candidates: previewCandidates,
      engineSha: input.engineSha,
      cutoverMode: cutover.mode,
    });
    return {
      manifest: {
        ...base,
        mode: "APPLY",
        overallStatus: "REFUSED",
        applyResults: orderIds.map((storeOrderId) => ({
          storeOrderId,
          classification: "R5_REQUIRES_PROVIDER_OR_OPERATOR" as const,
          reasonCodes: ["CUTOVER_MODE_REFUSED" as const],
          outcome: "REFUSED_CUTOVER" as const,
          createdTransferOperationId: null,
          preexistingTransferOperationId: null,
        })),
      },
      createdTransferOperations: [],
    };
  }

  if (input.expectedCandidateHash) {
    const previewCandidates: HistoricalToCandidateRecord[] = [];
    for (const id of orderIds) {
      const evidence = await loadHistoricalToCandidateEvidence(prisma, id);
      previewCandidates.push(classifyHistoricalTransferOperationCandidate(evidence));
    }
    const hash = hashHistoricalToCandidates(previewCandidates);
    if (hash !== input.expectedCandidateHash) {
      const base = buildHistoricalToPreviewManifest({
        candidates: previewCandidates,
        engineSha: input.engineSha,
        cutoverMode: cutover.mode,
      });
      return {
        manifest: {
          ...base,
          mode: "APPLY",
          overallStatus: "REFUSED",
          applyResults: orderIds.map((storeOrderId) => {
            const c = previewCandidates.find((x) => x.storeOrderId === storeOrderId)!;
            return {
              storeOrderId,
              classification: c.classification,
              reasonCodes: [...c.reasonCodes, "STALE_PREVIEW_RECLASSIFIED" as const],
              outcome: "REFUSED_STALE" as const,
              createdTransferOperationId: null,
              preexistingTransferOperationId: c.existingTransferOperationId,
            };
          }),
        },
        createdTransferOperations: [],
      };
    }
  }

  const applyResults: HistoricalToApplyItemResult[] = [];
  const createdTransferOperations: TransferOperation[] = [];
  const finalCandidates: HistoricalToCandidateRecord[] = [];
  let hasR3OrAmbiguous = false;

  for (const storeOrderId of orderIds) {
    const result = await prisma.$transaction(async (tx) => {
      await lockStoreOrderForUpdate(tx, storeOrderId);
      const evidence = await loadHistoricalToCandidateEvidence(tx as unknown as ApplyDb, storeOrderId);
      if (evidence.status === null && evidence.sellerId === null) {
        const record: HistoricalToCandidateRecord = {
          storeOrderId,
          memberId: null,
          legacyTransferId: null,
          legacyTransferIdMasked: null,
          expectedAmountCents: null,
          currency: HISTORICAL_STOREFRONT_TRANSFER_CURRENCY,
          orderStatus: null,
          saleLedgerCount: 0,
          saleLedgerAmountCents: null,
          saleLedgerCreatedAt: null,
          saleLedgerHasStripeTransferId: false,
          returnDebitCount: 0,
          hasStripeRefundId: false,
          hasRefundCompletedAt: false,
          existingTransferOperationId: null,
          classification: "R5_REQUIRES_PROVIDER_OR_OPERATOR",
          reasonCodes: ["ORDER_NOT_FOUND"],
        };
        return {
          record,
          item: {
            storeOrderId,
            classification: record.classification,
            reasonCodes: record.reasonCodes,
            outcome: "ORDER_MISSING" as const,
            createdTransferOperationId: null,
            preexistingTransferOperationId: null,
          },
          created: null as TransferOperation | null,
        };
      }

      const record = classifyHistoricalTransferOperationCandidate(evidence);

      if (record.classification === "ALREADY_CANONICAL") {
        return {
          record,
          item: {
            storeOrderId,
            classification: record.classification,
            reasonCodes: record.reasonCodes,
            outcome: "ALREADY_CANONICAL" as const,
            createdTransferOperationId: null,
            preexistingTransferOperationId: record.existingTransferOperationId,
          },
          created: null,
        };
      }

      if (record.classification !== "R1_UNAMBIGUOUS_PAID") {
        return {
          record,
          item: {
            storeOrderId,
            classification: record.classification,
            reasonCodes: record.reasonCodes,
            outcome: "SKIPPED_NOT_R1" as const,
            createdTransferOperationId: null,
            preexistingTransferOperationId: null,
          },
          created: null,
        };
      }

      const legacyId = evidence.stripeSellerTransferId!.trim();
      const amountCents = record.expectedAmountCents!;
      const saleCreatedAt = evidence.saleLedgers[0]!.createdAt;
      const key = foundationTransferIdempotencyKey(storeOrderId);

      // Direct insert of TransferOperation only — never invoke seller payout ledger helpers.
      try {
        const created = await tx.transferOperation.create({
          data: {
            storeOrderId,
            memberId: evidence.sellerId!,
            providerIdempotencyKey: key,
            stripeTransferId: legacyId,
            amountCents,
            currency: HISTORICAL_STOREFRONT_TRANSFER_CURRENCY,
            status: "SUCCEEDED",
            retryCount: 0,
            lastError: null,
            lastAttemptAt: null,
            succeededAt: saleCreatedAt,
            createdAt: saleCreatedAt,
          },
        });

        return {
          record: {
            ...record,
            existingTransferOperationId: created.id,
          },
          item: {
            storeOrderId,
            classification: record.classification,
            reasonCodes: record.reasonCodes,
            outcome: "CREATED" as const,
            createdTransferOperationId: created.id,
            preexistingTransferOperationId: null,
          },
          created,
        };
      } catch (err) {
        if (!(err instanceof PrismaNS.PrismaClientKnownRequestError) || err.code !== "P2002") {
          throw err;
        }
        // Do not trust P2002 alone — re-read unique owners and require exact equivalence.
        const expected = {
          storeOrderId,
          memberId: evidence.sellerId!,
          amountCents,
          currency: HISTORICAL_STOREFRONT_TRANSFER_CURRENCY,
          providerIdempotencyKey: key,
          stripeTransferId: legacyId,
          status: "SUCCEEDED" as const,
        };
        const [byOrder, byKey, byTransfer] = await Promise.all([
          tx.transferOperation.findUnique({ where: { storeOrderId } }),
          tx.transferOperation.findUnique({ where: { providerIdempotencyKey: key } }),
          tx.transferOperation.findUnique({ where: { stripeTransferId: legacyId } }),
        ]);
        const candidates = [byOrder, byKey, byTransfer].filter(
          (row): row is NonNullable<typeof row> => row != null
        );
        const exact = candidates.find((row) =>
          isExactHistoricalTransferOperationMatch(
            {
              storeOrderId: row.storeOrderId,
              memberId: row.memberId,
              amountCents: row.amountCents,
              currency: row.currency,
              providerIdempotencyKey: row.providerIdempotencyKey,
              stripeTransferId: row.stripeTransferId,
              status: row.status,
            },
            expected
          )
        );
        if (exact) {
          return {
            record: {
              ...record,
              classification: "ALREADY_CANONICAL" as const,
              reasonCodes: [...record.reasonCodes, "EXISTING_TRANSFER_OPERATION" as const],
              existingTransferOperationId: exact.id,
            },
            item: {
              storeOrderId,
              classification: "ALREADY_CANONICAL" as const,
              reasonCodes: [...record.reasonCodes, "EXISTING_TRANSFER_OPERATION" as const],
              outcome: "ALREADY_CANONICAL" as const,
              createdTransferOperationId: null,
              preexistingTransferOperationId: exact.id,
            },
            created: null,
          };
        }
        return {
          record: {
            ...record,
            classification: "R4_DATA_INCONSISTENCY" as const,
            reasonCodes: [
              ...record.reasonCodes,
              "EXISTING_TRANSFER_OPERATION_CONFLICT" as const,
            ],
            existingTransferOperationId: byOrder?.id ?? byKey?.id ?? byTransfer?.id ?? null,
          },
          item: {
            storeOrderId,
            classification: "R4_DATA_INCONSISTENCY" as const,
            reasonCodes: [
              ...record.reasonCodes,
              "EXISTING_TRANSFER_OPERATION_CONFLICT" as const,
            ],
            outcome: "SKIPPED_NOT_R1" as const,
            createdTransferOperationId: null,
            preexistingTransferOperationId: byOrder?.id ?? byKey?.id ?? byTransfer?.id ?? null,
          },
          created: null,
        };
      }
    });

    finalCandidates.push(result.record);
    applyResults.push(result.item);
    if (result.created) createdTransferOperations.push(result.created);
    if (
      result.record.classification === "R3_ALREADY_REFUNDED_LEGACY" ||
      result.record.classification === "R2_AMOUNT_OR_LEDGER_AMBIGUOUS" ||
      result.record.classification === "R4_DATA_INCONSISTENCY" ||
      result.record.classification === "R5_REQUIRES_PROVIDER_OR_OPERATOR"
    ) {
      hasR3OrAmbiguous = true;
    }
  }

  const counts = {
    R1_UNAMBIGUOUS_PAID: 0,
    R2_AMOUNT_OR_LEDGER_AMBIGUOUS: 0,
    R3_ALREADY_REFUNDED_LEGACY: 0,
    R4_DATA_INCONSISTENCY: 0,
    R5_REQUIRES_PROVIDER_OR_OPERATOR: 0,
    ALREADY_CANONICAL: 0,
    NOT_A_LEGACY_TRANSFER_CANDIDATE: 0,
    created: createdTransferOperations.length,
    skipped: applyResults.filter((r) => r.outcome === "SKIPPED_NOT_R1").length,
  };
  for (const c of finalCandidates) {
    counts[c.classification] += 1;
  }

  let overallStatus: HistoricalToApplyOverallStatus = "COMPLETE";
  if (hasR3OrAmbiguous) overallStatus = "PARTIAL_BLOCKED_RESIDUALS";
  if (createdTransferOperations.length === 0 && hasR3OrAmbiguous) {
    overallStatus = "PARTIAL_BLOCKED_RESIDUALS";
  }

  const conflicts = finalCandidates
    .filter(
      (c) =>
        c.classification === "R3_ALREADY_REFUNDED_LEGACY" ||
        c.classification === "R4_DATA_INCONSISTENCY" ||
        c.classification === "R2_AMOUNT_OR_LEDGER_AMBIGUOUS" ||
        c.classification === "R5_REQUIRES_PROVIDER_OR_OPERATOR"
    )
    .map((c) => ({ storeOrderId: c.storeOrderId, reasonCodes: c.reasonCodes }));

  const manifest: HistoricalTransferOperationBackfillManifest = {
    manifestVersion: HISTORICAL_TO_BACKFILL_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    engineSha: input.engineSha ?? null,
    mode: "APPLY",
    candidateHash: hashHistoricalToCandidates(finalCandidates),
    cutoverMode: cutover.mode,
    candidateCount: finalCandidates.length,
    counts,
    overallStatus,
    candidates: finalCandidates,
    applyResults,
    conflicts,
  };

  return { manifest, createdTransferOperations };
}
