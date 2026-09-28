import type { PrismaClient } from "@prisma/client";
import { applyShopifyPaidOrderLineSale } from "./order-sale";

export type ReconcileShopifyImportBootstrapResult = {
  preBootstrapAcked: number;
  postBootstrapApplied: number;
  postBootstrapAlreadyApplied: number;
  postBootstrapFailed: number;
  postBootstrapUnmapped: number;
};

/**
 * After import mapping activation, reconcile durable ORDERS_PAID sale facts for the imported variant.
 *
 * Exact provider Variant GID only (never SKU/title).
 * - evidence.triggeredAt < bootstrapStartedAt → PRE_BOOTSTRAP_ACKED (no second SALE)
 * - null / equal / after / uncertain → apply SALE (oversell guard prefers deduction)
 *
 * Exactly-once identity remains connection + Order GID + LineItem GID.
 * Idempotent: PRE_BOOTSTRAP_ACKED / APPLIED facts are skipped on replay.
 */
export async function reconcileShopifyImportBootstrapSales(
  db: PrismaClient,
  input: {
    connectionId: string;
    memberId: string;
    shopifyVariantId: string;
    bootstrapStartedAt: Date;
  },
  deps: {
    applySale?: typeof applyShopifyPaidOrderLineSale;
  } = {}
): Promise<ReconcileShopifyImportBootstrapResult> {
  const applySale = deps.applySale ?? applyShopifyPaidOrderLineSale;
  const result: ReconcileShopifyImportBootstrapResult = {
    preBootstrapAcked: 0,
    postBootstrapApplied: 0,
    postBootstrapAlreadyApplied: 0,
    postBootstrapFailed: 0,
    postBootstrapUnmapped: 0,
  };

  // Only facts for this exact mapped Variant GID on this connection generation.
  const facts = await db.shopifyOrderLineSaleFact.findMany({
    where: {
      shopifyConnectionId: input.connectionId,
      memberId: input.memberId,
      shopifyVariantId: input.shopifyVariantId,
      applyState: { in: ["UNMAPPED", "PENDING", "FAILED"] },
    },
    select: {
      id: true,
      shopifyOrderId: true,
      shopifyLineItemId: true,
      shopifyVariantId: true,
      paidQuantity: true,
      evidenceId: true,
      applyState: true,
      evidence: { select: { triggeredAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const fact of facts) {
    if (!fact.shopifyVariantId || fact.shopifyVariantId !== input.shopifyVariantId) {
      continue;
    }

    const triggeredAt = fact.evidence?.triggeredAt ?? null;
    const definitelyBefore =
      triggeredAt instanceof Date &&
      !Number.isNaN(triggeredAt.getTime()) &&
      triggeredAt.getTime() < input.bootstrapStartedAt.getTime();

    if (definitelyBefore) {
      // Conditional update: never rewrite APPLIED / already-acked facts.
      const acked = await db.shopifyOrderLineSaleFact.updateMany({
        where: {
          id: fact.id,
          applyState: { in: ["UNMAPPED", "PENDING", "FAILED"] },
        },
        data: {
          applyState: "PRE_BOOTSTRAP_ACKED",
          lastErrorCode: "PRE_BOOTSTRAP_SNAPSHOT",
          lastErrorMessage:
            "Sale occurred before import bootstrap cutoff and is represented by opening stock",
          appliedAt: new Date(),
        },
      });
      if (acked.count > 0) result.preBootstrapAcked += 1;
      continue;
    }

    // At/after cutoff, equal cutoff, null/malformed timestamp → apply SALE.
    const apply = await applySale(db, {
      connectionId: input.connectionId,
      memberId: input.memberId,
      evidenceId: fact.evidenceId,
      line: {
        shopifyOrderId: fact.shopifyOrderId,
        shopifyLineItemId: fact.shopifyLineItemId,
        shopifyVariantId: fact.shopifyVariantId,
        paidQuantity: fact.paidQuantity,
      },
    });
    if (apply.status === "APPLIED") result.postBootstrapApplied += 1;
    else if (apply.status === "ALREADY_APPLIED") result.postBootstrapAlreadyApplied += 1;
    else if (apply.status === "FAILED") result.postBootstrapFailed += 1;
    else if (apply.status === "UNMAPPED") result.postBootstrapUnmapped += 1;
  }

  return result;
}
