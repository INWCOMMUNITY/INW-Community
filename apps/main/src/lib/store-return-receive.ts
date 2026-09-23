import type { PrismaClient } from "database";
import { isAwaitingReturnStatus, isReturnReceiveRefundRetryable } from "@/lib/store-return";
import { refundArgsFromReturnPolicy } from "@/lib/stripe/refund-store-order";

type ReturnReceiveClient = Pick<PrismaClient, "$transaction">;

export type ClaimedReturnRefundArgs = {
  amountCents: number;
  transferReversalCents: number;
  ledgerDebitCents: number;
};

export type ClaimStoreReturnReceiptResult =
  | { action: "ineligible" }
  | { action: "invalid_amount" }
  | { action: "already_complete"; amountCents: number }
  | {
      action: "order_already_refunded";
      amountCents: number;
      firstReceipt: boolean;
      refundArgs: ClaimedReturnRefundArgs;
    }
  | {
      action: "refund";
      amountCents: number;
      firstReceipt: boolean;
      refundArgs: ClaimedReturnRefundArgs;
    };

/**
 * Record physical receipt at most once, snapshot the refund amount, and leave
 * `received` returns eligible to resume financial convergence.
 * Locks StoreOrder then StoreReturn (never invert with TransferOperation writers).
 */
export async function claimStoreReturnReceiptForRefund(
  prisma: ReturnReceiveClient,
  input: {
    storeOrderId: string;
    storeReturnId: string;
    order: {
      totalCents: number;
      subtotalCents: number;
      taxCents?: number | null;
    };
    labelCostCents: number;
    chargeReturnShipping: boolean;
  }
): Promise<ClaimStoreReturnReceiptResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "StoreOrder" WHERE "id" = ${input.storeOrderId} FOR UPDATE`;
    await tx.$executeRaw`SELECT 1 FROM "StoreReturn" WHERE "id" = ${input.storeReturnId} FOR UPDATE`;
    const lockedReturn = await tx.storeReturn.findUnique({ where: { id: input.storeReturnId } });
    const lockedOrder = await tx.storeOrder.findUnique({
      where: { id: input.storeOrderId },
      select: { status: true },
    });
    if (!lockedReturn || lockedReturn.orderId !== input.storeOrderId || !lockedOrder) {
      return { action: "ineligible" as const };
    }
    if (lockedReturn.status === "refunded") {
      return {
        action: "already_complete" as const,
        amountCents: lockedReturn.refundAmountCents ?? 0,
      };
    }
    if (!isReturnReceiveRefundRetryable(lockedReturn.status)) {
      return { action: "ineligible" as const };
    }

    const firstReceipt = isAwaitingReturnStatus(lockedReturn.status);
    const labelCostCents = lockedReturn.returnLabelCostCents ?? input.labelCostCents;
    const computed = refundArgsFromReturnPolicy(input.order, {
      chargeReturnShipping: input.chargeReturnShipping,
      returnLabelCostCents: labelCostCents,
    });
    const amountCents = lockedReturn.refundAmountCents ?? computed.amountCents;
    if (amountCents < 0) {
      return { action: "invalid_amount" as const };
    }
    const refundArgs: ClaimedReturnRefundArgs = {
      amountCents,
      transferReversalCents: computed.transferReversalCents,
      ledgerDebitCents: computed.ledgerDebitCents,
    };
    const now = new Date();
    await tx.storeReturn.update({
      where: { id: lockedReturn.id },
      data: {
        status: "received",
        receivedAt: lockedReturn.receivedAt ?? now,
        returnLabelCostCents: labelCostCents,
        refundAmountCents: lockedReturn.refundAmountCents ?? amountCents,
      },
    });

    if (lockedOrder.status === "refunded") {
      return {
        action: "order_already_refunded" as const,
        amountCents,
        firstReceipt,
        refundArgs,
      };
    }
    return {
      action: "refund" as const,
      amountCents,
      firstReceipt,
      refundArgs,
    };
  });
}

export async function markStoreReturnRefundedOnce(
  prisma: Pick<PrismaClient, "storeReturn">,
  input: { storeReturnId: string; amountCents: number }
): Promise<boolean> {
  const updated = await prisma.storeReturn.updateMany({
    where: { id: input.storeReturnId, status: "received" },
    data: {
      status: "refunded",
      refundedAt: new Date(),
      refundAmountCents: input.amountCents,
    },
  });
  return updated.count > 0;
}
