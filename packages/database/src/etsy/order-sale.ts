import type { Prisma, PrismaClient, EtsyOrderLineSaleFact } from "@prisma/client";
import {
  applyTrackedMarketplaceSale,
  ETSY_SOURCE_SYSTEM,
  FoundationInsufficientAvailabilityError,
  FoundationInventoryError,
} from "../commerce-foundation-inventory";

export type EtsyOrderSaleDb = PrismaClient | Prisma.TransactionClient;

export type EtsyPaidOrderLineObservation = {
  etsyReceiptId: string;
  etsyTransactionId: string;
  etsyListingId: string | null;
  etsyProductId: string | null;
  etsyOfferingId: string | null;
  paidQuantity: number;
  /** When set, sales at/before this cutoff ack without deducting (import opening stock). */
  importBootstrapStartedAt?: Date | null;
  triggeredAt?: Date | null;
};

export type ApplyEtsyPaidOrderLineResult =
  | { status: "APPLIED"; factId: string; appliedQuantity: number; inventoryEventId: string | null }
  | { status: "ALREADY_APPLIED"; factId: string; appliedQuantity: number }
  | { status: "PRE_BOOTSTRAP_ACKED"; factId: string }
  | { status: "UNMAPPED"; factId: string }
  | { status: "FAILED"; factId: string; code: string; message: string }
  | {
      status: "CAUSAL_FACT_CONFLICT";
      factId: string;
      code: string;
      message: string;
      appliedQuantity: number;
      applyState: EtsyOrderLineSaleFact["applyState"];
    };

function lineLockKey(connectionId: string, receiptId: string, transactionId: string): string {
  return `etsy-order-line-sale:${connectionId}:${receiptId}:${transactionId}`;
}

type FactEquivalence =
  | { status: "EXACT" }
  | { status: "CONFLICT"; code: string; message: string };

export function classifyEtsySaleFactEquivalence(
  existing: Pick<
    EtsyOrderLineSaleFact,
    "paidQuantity" | "etsyProductId" | "etsyOfferingId" | "storeVariantId"
  >,
  incoming: EtsyPaidOrderLineObservation,
  resolvedStoreVariantId?: string | null
): FactEquivalence {
  if (existing.paidQuantity !== incoming.paidQuantity) {
    return {
      status: "CONFLICT",
      code: "PAID_QUANTITY_CONFLICT",
      message: `Conflicting paidQuantity for sale fact: stored ${existing.paidQuantity}, incoming ${incoming.paidQuantity}`,
    };
  }
  if (existing.etsyOfferingId != null && incoming.etsyOfferingId != null) {
    if (existing.etsyOfferingId !== incoming.etsyOfferingId) {
      return {
        status: "CONFLICT",
        code: "OFFERING_IDENTITY_CONFLICT",
        message: `Conflicting Etsy offering id: stored ${existing.etsyOfferingId}, incoming ${incoming.etsyOfferingId}`,
      };
    }
  }
  if (existing.etsyProductId != null && incoming.etsyProductId != null) {
    if (existing.etsyProductId !== incoming.etsyProductId) {
      return {
        status: "CONFLICT",
        code: "PRODUCT_IDENTITY_CONFLICT",
        message: `Conflicting Etsy product id: stored ${existing.etsyProductId}, incoming ${incoming.etsyProductId}`,
      };
    }
  }
  if (
    existing.storeVariantId != null &&
    resolvedStoreVariantId != null &&
    existing.storeVariantId !== resolvedStoreVariantId
  ) {
    return {
      status: "CONFLICT",
      code: "STORE_VARIANT_MAPPING_CONFLICT",
      message: `Conflicting StoreVariant mapping: stored ${existing.storeVariantId}, resolved ${resolvedStoreVariantId}`,
    };
  }
  return { status: "EXACT" };
}

async function recordCausalFactConflict(
  tx: Prisma.TransactionClient,
  fact: EtsyOrderLineSaleFact,
  input: { evidenceId: string; code: string; message: string }
): Promise<ApplyEtsyPaidOrderLineResult> {
  const updated = await tx.etsyOrderLineSaleFact.update({
    where: { id: fact.id },
    data: {
      causalConflict: true,
      causalConflictCode: input.code.slice(0, 64),
      causalConflictEvidenceId: input.evidenceId,
      causalConflictDetectedAt: new Date(),
    },
  });
  return {
    status: "CAUSAL_FACT_CONFLICT",
    factId: updated.id,
    code: input.code,
    message: input.message,
    appliedQuantity: updated.appliedQuantity,
    applyState: updated.applyState,
  };
}

function isPreBootstrap(line: EtsyPaidOrderLineObservation): boolean {
  if (!(line.importBootstrapStartedAt instanceof Date) || !(line.triggeredAt instanceof Date)) {
    return false;
  }
  return line.triggeredAt.getTime() <= line.importBootstrapStartedAt.getTime();
}

/**
 * Apply one paid Etsy receipt transaction as an exactly-once Foundation SALE (when mapped + tracked).
 * Idempotent on (connection, receipt, transaction). Conflicting causal replays fail closed.
 */
export async function applyEtsyPaidOrderLineSale(
  db: PrismaClient,
  input: {
    connectionId: string;
    memberId: string;
    evidenceId: string;
    line: EtsyPaidOrderLineObservation;
  }
): Promise<ApplyEtsyPaidOrderLineResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lineLockKey(
      input.connectionId,
      input.line.etsyReceiptId,
      input.line.etsyTransactionId
    )}))`;

    const existing = await tx.etsyOrderLineSaleFact.findUnique({
      where: {
        etsyConnectionId_etsyReceiptId_etsyTransactionId: {
          etsyConnectionId: input.connectionId,
          etsyReceiptId: input.line.etsyReceiptId,
          etsyTransactionId: input.line.etsyTransactionId,
        },
      },
    });

    if (existing) {
      const equiv = classifyEtsySaleFactEquivalence(existing, input.line);
      if (equiv.status === "CONFLICT") {
        return recordCausalFactConflict(tx, existing, {
          evidenceId: input.evidenceId,
          code: equiv.code,
          message: equiv.message,
        });
      }
      if (
        existing.applyState === "APPLIED" ||
        existing.applyState === "PRE_BOOTSTRAP_ACKED"
      ) {
        return {
          status: "ALREADY_APPLIED" as const,
          factId: existing.id,
          appliedQuantity: existing.appliedQuantity,
        };
      }
    }

    let fact: EtsyOrderLineSaleFact;
    if (existing) {
      fact = existing;
    } else {
      try {
        fact = await tx.etsyOrderLineSaleFact.create({
          data: {
            etsyConnectionId: input.connectionId,
            memberId: input.memberId,
            etsyReceiptId: input.line.etsyReceiptId,
            etsyTransactionId: input.line.etsyTransactionId,
            etsyListingId: input.line.etsyListingId,
            etsyProductId: input.line.etsyProductId,
            etsyOfferingId: input.line.etsyOfferingId,
            paidQuantity: input.line.paidQuantity,
            evidenceId: input.evidenceId,
            applyState: "PENDING",
          },
        });
      } catch (error) {
        if (
          !(
            error &&
            typeof error === "object" &&
            "code" in error &&
            (error as { code?: string }).code === "P2002"
          )
        ) {
          throw error;
        }
        const raced = await tx.etsyOrderLineSaleFact.findUnique({
          where: {
            etsyConnectionId_etsyReceiptId_etsyTransactionId: {
              etsyConnectionId: input.connectionId,
              etsyReceiptId: input.line.etsyReceiptId,
              etsyTransactionId: input.line.etsyTransactionId,
            },
          },
        });
        if (!raced) throw error;
        const racedEquiv = classifyEtsySaleFactEquivalence(raced, input.line);
        if (racedEquiv.status === "CONFLICT") {
          return recordCausalFactConflict(tx, raced, {
            evidenceId: input.evidenceId,
            code: racedEquiv.code,
            message: racedEquiv.message,
          });
        }
        if (raced.applyState === "APPLIED" || raced.applyState === "PRE_BOOTSTRAP_ACKED") {
          return {
            status: "ALREADY_APPLIED" as const,
            factId: raced.id,
            appliedQuantity: raced.appliedQuantity,
          };
        }
        fact = raced;
      }
    }

    if (isPreBootstrap(input.line)) {
      const acked = await tx.etsyOrderLineSaleFact.update({
        where: { id: fact.id },
        data: {
          applyState: "PRE_BOOTSTRAP_ACKED",
          appliedQuantity: 0,
          appliedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      return { status: "PRE_BOOTSTRAP_ACKED" as const, factId: acked.id };
    }

    let variantMap =
      input.line.etsyOfferingId != null
        ? await tx.etsyVariantMap.findFirst({
            where: {
              etsyConnectionId: input.connectionId,
              etsyOfferingId: input.line.etsyOfferingId,
            },
          })
        : null;
    if (!variantMap && input.line.etsyProductId != null) {
      variantMap = await tx.etsyVariantMap.findFirst({
        where: {
          etsyConnectionId: input.connectionId,
          etsyProductId: input.line.etsyProductId,
        },
      });
    }
    if (!variantMap && input.line.etsyListingId != null) {
      const link = await tx.etsyListingLink.findFirst({
        where: {
          etsyConnectionId: input.connectionId,
          etsyListingId: input.line.etsyListingId,
        },
        include: { variantMaps: { orderBy: { createdAt: "asc" }, take: 1 } },
      });
      if (link?.variantMaps.length === 1) {
        variantMap = link.variantMaps[0]!;
      }
    }

    if (!variantMap || variantMap.memberId !== input.memberId) {
      const unmapped = await tx.etsyOrderLineSaleFact.update({
        where: { id: fact.id },
        data: {
          applyState: "UNMAPPED",
          lastErrorCode: "UNMAPPED_VARIANT",
          lastErrorMessage: "No StoreVariant mapping for this Etsy transaction on this connection generation",
        },
      });
      return { status: "UNMAPPED" as const, factId: unmapped.id };
    }

    const mapEquiv = classifyEtsySaleFactEquivalence(fact, input.line, variantMap.storeVariantId);
    if (mapEquiv.status === "CONFLICT") {
      return recordCausalFactConflict(tx, fact, {
        evidenceId: input.evidenceId,
        code: mapEquiv.code,
        message: mapEquiv.message,
      });
    }

    // Import bootstrap from listing link when caller omitted it.
    if (!input.line.importBootstrapStartedAt && input.line.triggeredAt) {
      const link = await tx.etsyListingLink.findFirst({
        where: {
          etsyConnectionId: input.connectionId,
          storeItemId: variantMap.storeItemId,
        },
        select: { importBootstrapStartedAt: true },
      });
      if (
        link?.importBootstrapStartedAt &&
        input.line.triggeredAt.getTime() <= link.importBootstrapStartedAt.getTime()
      ) {
        const acked = await tx.etsyOrderLineSaleFact.update({
          where: { id: fact.id },
          data: {
            applyState: "PRE_BOOTSTRAP_ACKED",
            storeVariantId: variantMap.storeVariantId,
            storeItemId: variantMap.storeItemId,
            appliedQuantity: 0,
            appliedAt: new Date(),
          },
        });
        return { status: "PRE_BOOTSTRAP_ACKED" as const, factId: acked.id };
      }
    }

    try {
      const sale = await applyTrackedMarketplaceSale(tx, {
        variantId: variantMap.storeVariantId,
        memberId: input.memberId,
        qty: fact.paidQuantity,
        sourceScope: input.connectionId,
        sourceFactId: `${fact.etsyReceiptId}:${fact.etsyTransactionId}`,
        sourceSystem: ETSY_SOURCE_SYSTEM,
        metadata: {
          etsyReceiptId: fact.etsyReceiptId,
          etsyTransactionId: fact.etsyTransactionId,
          etsyListingId: input.line.etsyListingId,
          etsyProductId: input.line.etsyProductId,
          etsyOfferingId: input.line.etsyOfferingId,
          evidenceId: input.evidenceId,
        },
      });

      const applied = await tx.etsyOrderLineSaleFact.update({
        where: { id: fact.id },
        data: {
          applyState: "APPLIED",
          appliedQuantity: fact.paidQuantity,
          storeVariantId: variantMap.storeVariantId,
          storeItemId: variantMap.storeItemId,
          etsyProductId: input.line.etsyProductId ?? fact.etsyProductId,
          etsyOfferingId: input.line.etsyOfferingId ?? fact.etsyOfferingId,
          etsyListingId: input.line.etsyListingId ?? fact.etsyListingId,
          inventoryEventId: sale.inventoryEventId,
          appliedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      return {
        status: "APPLIED" as const,
        factId: applied.id,
        appliedQuantity: applied.appliedQuantity,
        inventoryEventId: sale.inventoryEventId,
      };
    } catch (error) {
      const code =
        error instanceof FoundationInsufficientAvailabilityError
          ? "INSUFFICIENT_AVAILABILITY"
          : error instanceof FoundationInventoryError
            ? error.code
            : "SALE_APPLY_FAILED";
      const message = error instanceof Error ? error.message.slice(0, 500) : "Sale apply failed";
      const failed = await tx.etsyOrderLineSaleFact.update({
        where: { id: fact.id },
        data: {
          applyState: "FAILED",
          storeVariantId: variantMap.storeVariantId,
          storeItemId: variantMap.storeItemId,
          lastErrorCode: code.slice(0, 64),
          lastErrorMessage: message,
        },
      });
      return {
        status: "FAILED" as const,
        factId: failed.id,
        code,
        message,
      };
    }
  });
}

export async function applyEtsyPaidOrderObservation(
  db: PrismaClient,
  input: {
    connectionId: string;
    memberId: string;
    evidenceId: string;
    lines: EtsyPaidOrderLineObservation[];
  }
): Promise<{ status: "PROCESSED"; lines: ApplyEtsyPaidOrderLineResult[] }> {
  const lines: ApplyEtsyPaidOrderLineResult[] = [];
  for (const line of input.lines) {
    lines.push(
      await applyEtsyPaidOrderLineSale(db, {
        connectionId: input.connectionId,
        memberId: input.memberId,
        evidenceId: input.evidenceId,
        line,
      })
    );
  }
  return { status: "PROCESSED", lines };
}
