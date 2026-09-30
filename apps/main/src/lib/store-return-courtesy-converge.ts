import type { PrismaClient, StoreReturn } from "database";
import { ACTIVE_STORE_RETURN_STATUSES } from "@/lib/store-return";
import { LATEST_STORE_RETURN_ORDER_BY } from "@/lib/store-return-order";

export type ConvergeCourtesyRefundStoreReturnInput = {
  storeOrderId: string;
  amountCents: number;
  /** Pre-provider ID hint only — always re-read under lock. */
  hintStoreReturnId?: string | null;
  reason?: string | null;
  now?: Date;
};

export type ConvergeCourtesyRefundStoreReturnResult =
  | {
      ok: true;
      storeReturn: StoreReturn;
      action: "updated" | "created" | "already_refunded";
    }
  | { ok: false; error: "not_found" | "multiple_active" };

/**
 * Post-provider local convergence for courtesy refund StoreReturn history.
 * Locks StoreOrder, re-reads current returns, never trusts a pre-Stripe snapshot.
 * No Stripe / network / money movement inside this transaction.
 */
export async function convergeCourtesyRefundStoreReturn(
  prisma: PrismaClient,
  input: ConvergeCourtesyRefundStoreReturnInput
): Promise<ConvergeCourtesyRefundStoreReturnResult> {
  const now = input.now ?? new Date();
  const amountCents = Math.max(0, input.amountCents);
  const reason = input.reason?.trim() || "Courtesy refund";

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "StoreOrder" WHERE "id" = ${input.storeOrderId} FOR UPDATE`;

    const order = await tx.storeOrder.findUnique({
      where: { id: input.storeOrderId },
      select: { id: true },
    });
    if (!order) {
      return { ok: false, error: "not_found" } as const;
    }

    const actives = await tx.storeReturn.findMany({
      where: {
        orderId: order.id,
        status: { in: [...ACTIVE_STORE_RETURN_STATUSES] },
      },
      orderBy: [...LATEST_STORE_RETURN_ORDER_BY],
    });

    if (actives.length > 1) {
      return { ok: false, error: "multiple_active" } as const;
    }

    if (actives.length === 1) {
      const updated = await tx.storeReturn.update({
        where: { id: actives[0]!.id },
        data: {
          status: "refunded",
          requireReturn: false,
          refundedAt: now,
          refundAmountCents: amountCents,
        },
      });
      return { ok: true, storeReturn: updated, action: "updated" } as const;
    }

    // No active return — hint is advisory only.
    if (input.hintStoreReturnId) {
      const hinted = await tx.storeReturn.findFirst({
        where: { id: input.hintStoreReturnId, orderId: order.id },
      });
      if (hinted?.status === "refunded") {
        return { ok: true, storeReturn: hinted, action: "already_refunded" } as const;
      }
    }

    const existingRefunded = await tx.storeReturn.findFirst({
      where: { orderId: order.id, status: "refunded" },
      orderBy: [...LATEST_STORE_RETURN_ORDER_BY],
    });
    if (existingRefunded) {
      return { ok: true, storeReturn: existingRefunded, action: "already_refunded" } as const;
    }

    const created = await tx.storeReturn.create({
      data: {
        orderId: order.id,
        status: "refunded",
        requireReturn: false,
        reason,
        refundedAt: now,
        refundAmountCents: amountCents,
      },
    });
    return { ok: true, storeReturn: created, action: "created" } as const;
  });
}
