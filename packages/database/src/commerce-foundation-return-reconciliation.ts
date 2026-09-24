import type { PrismaClient } from "@prisma/client";

export const FOUNDATION_RETURN_SETTLEMENT_RECONCILIATION_BATCH_SIZE = 50;

export type FoundationReturnSettlementCandidate = {
  storeReturnId: string;
  storeOrderId: string;
  sellerId: string;
};

/**
 * Bounded automatic return-settlement candidates.
 * Only `StoreReturn.status = "received"`: physical receipt is complete, settlement may not be.
 * Terminal `refunded` rows are excluded (Unit 5C admin anomalies).
 *
 * Ordering: receivedAt ASC with PostgreSQL NULLS LAST, then id ASC.
 * A received row with null receivedAt is still eligible but sorts after every
 * non-null receivedAt, then by id among other null-receivedAt rows.
 */
export async function listFoundationReturnSettlementCandidates(
  prisma: PrismaClient,
  args?: { take?: number }
): Promise<FoundationReturnSettlementCandidate[]> {
  const take = args?.take ?? FOUNDATION_RETURN_SETTLEMENT_RECONCILIATION_BATCH_SIZE;
  const rows = await prisma.storeReturn.findMany({
    where: { status: "received" },
    orderBy: [{ receivedAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    take,
    select: {
      id: true,
      orderId: true,
      order: { select: { sellerId: true } },
    },
  });
  return rows.map((row) => ({
    storeReturnId: row.id,
    storeOrderId: row.orderId,
    sellerId: row.order.sellerId,
  }));
}
