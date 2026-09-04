import Stripe from "stripe";
import { prisma } from "database";
import { restockOrderLinesAfterReturn } from "@/lib/store-item-restock";
import { syncInventoryToChannelsAfterSale } from "@/lib/channels/sync-inventory";
import { computeSellerTransferCents } from "@/lib/storefront-payout";
import {
  fullRefundChargeCents,
  returnRefundAmountCents,
  sellerLedgerDebitForReturnCents,
  sellerTransferReversalCents,
} from "@/lib/store-return";

export function refundAmountCents(order: { totalCents: number; taxCents?: number | null }): number {
  return fullRefundChargeCents(order);
}

export function sellerLedgerDebitCents(order: {
  totalCents: number;
  subtotalCents: number;
}): number {
  return computeSellerTransferCents(order.totalCents, order.subtotalCents).sellerTransferCents;
}

async function reverseConnectTransfer(
  stripe: Stripe,
  transferId: string,
  amountCents?: number
): Promise<void> {
  try {
    if (amountCents != null && amountCents <= 0) return;
    if (amountCents != null) {
      await stripe.transfers.createReversal(transferId, { amount: amountCents });
      return;
    }
    await stripe.transfers.createReversal(transferId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/already been reversed|no such transfer/i.test(msg)) return;
    throw e;
  }
}

type LedgerTx = {
  sellerBalance: {
    upsert: (args: {
      where: { memberId: string };
      create: { memberId: string; balanceCents: number; totalEarnedCents: number };
      update: { balanceCents: { decrement: number } };
    }) => Promise<unknown>;
  };
  sellerBalanceTransaction: {
    create: (args: {
      data: {
        memberId: string;
        type: string;
        amountCents: number;
        orderId: string;
        description: string;
      };
    }) => Promise<unknown>;
  };
};

async function debitSellerLedgerForRefund(
  tx: LedgerTx,
  order: { id: string; sellerId: string; totalCents: number; subtotalCents: number },
  debitCents?: number
): Promise<void> {
  const debit = debitCents ?? sellerLedgerDebitCents(order);
  if (debit <= 0) return;
  await tx.sellerBalance.upsert({
    where: { memberId: order.sellerId },
    create: {
      memberId: order.sellerId,
      balanceCents: -debit,
      totalEarnedCents: 0,
    },
    update: { balanceCents: { decrement: debit } },
  });
  await tx.sellerBalanceTransaction.create({
    data: {
      memberId: order.sellerId,
      type: "return",
      amountCents: -debit,
      orderId: order.id,
      description: `Refund: Order #${order.id.slice(-6)}`,
    },
  });
}

/**
 * Refund a paid storefront order on the **platform** account (facilitator Checkout),
 * reverse the Connect transfer when present, optionally restock, and flip sold_out → active.
 */
export async function refundPaidStorefrontOrder(args: {
  stripe: Stripe;
  order: {
    id: string;
    sellerId: string;
    status: string;
    totalCents: number;
    subtotalCents: number;
    taxCents?: number | null;
    stripePaymentIntentId: string | null;
    stripeSellerTransferId?: string | null;
    items: Array<{ storeItemId: string; quantity: number; variant?: unknown }>;
  };
  reason?: string;
  note?: string | null;
  /** Override Stripe refund amount. Defaults to full charge (item + tax). */
  amountCents?: number;
  /** Override Connect transfer reversal. Defaults to the full original transfer. */
  transferReversalCents?: number;
  /** Override My Funds debit. Defaults to the full original seller transfer. */
  ledgerDebitCents?: number;
  /** When false, buyer keeps the item (courtesy refund). Default true. */
  restock?: boolean;
}): Promise<{ ok: true; refunded: true; amountCents: number } | { ok: false; error: string; status: number }> {
  const { stripe, order } = args;
  if (order.status === "refunded") {
    return { ok: false, error: "Order already refunded", status: 400 };
  }
  if (!order.stripePaymentIntentId) {
    return { ok: false, error: "Order has no payment to refund", status: 400 };
  }

  const amount = args.amountCents ?? refundAmountCents(order);
  if (amount <= 0) {
    return { ok: false, error: "Refund amount must be greater than zero", status: 400 };
  }

  const originalTransfer = sellerLedgerDebitCents(order);
  const reversalAmount = args.transferReversalCents ?? originalTransfer;

  if (order.stripeSellerTransferId) {
    try {
      await reverseConnectTransfer(
        stripe,
        order.stripeSellerTransferId,
        args.transferReversalCents != null ? reversalAmount : undefined
      );
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Could not reverse seller transfer",
        status: 500,
      };
    }
  }

  try {
    await stripe.refunds.create({
      payment_intent: order.stripePaymentIntentId,
      amount,
      reason: "requested_by_customer",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Refund failed";
    if (!/already been refunded|charge already refunded/i.test(msg)) {
      return { ok: false, error: msg, status: 500 };
    }
  }

  const shouldRestock = args.restock !== false;
  await prisma.$transaction(async (tx) => {
    await tx.storeOrder.update({
      where: { id: order.id },
      data: {
        status: "refunded",
        cancelReason: args.reason,
        cancelNote: args.note ?? undefined,
        inventoryRestoredAt: shouldRestock ? new Date() : undefined,
      },
    });
    if (shouldRestock) {
      await restockOrderLinesAfterReturn(tx, order.items);
    }
    await debitSellerLedgerForRefund(tx, order, args.ledgerDebitCents);
  });

  if (shouldRestock) {
    await Promise.all(order.items.map((oi) => syncInventoryToChannelsAfterSale(oi.storeItemId)));
  }
  return { ok: true, refunded: true, amountCents: amount };
}

export function refundArgsFromReturnPolicy(order: {
  totalCents: number;
  subtotalCents: number;
  taxCents?: number | null;
}, policy: { chargeReturnShipping: boolean; returnLabelCostCents?: number | null }): {
  amountCents: number;
  transferReversalCents: number;
  ledgerDebitCents: number;
} {
  const originalTransfer = sellerLedgerDebitCents(order);
  return {
    amountCents: returnRefundAmountCents({
      totalCents: order.totalCents,
      taxCents: order.taxCents,
      chargeReturnShipping: policy.chargeReturnShipping,
      returnLabelCostCents: policy.returnLabelCostCents,
    }),
    transferReversalCents: sellerTransferReversalCents({
      originalTransferCents: originalTransfer,
      chargeReturnShipping: policy.chargeReturnShipping,
      returnLabelCostCents: policy.returnLabelCostCents,
    }),
    ledgerDebitCents: sellerLedgerDebitForReturnCents({
      originalDebitCents: originalTransfer,
      chargeReturnShipping: policy.chargeReturnShipping,
      returnLabelCostCents: policy.returnLabelCostCents,
    }),
  };
}

/** Dashboard / charge.refunded / dispute: reverse Connect transfer, debit ledger, restock once. */
export async function restockAfterExternalRefund(
  orderId: string,
  stripe?: Stripe | null
): Promise<boolean> {
  const order = await prisma.storeOrder.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) return false;
  if (order.inventoryRestoredAt) return false;
  if (!["paid", "shipped", "delivered"].includes(order.status) && order.status !== "refunded") {
    return false;
  }

  if (stripe && order.stripeSellerTransferId) {
    await reverseConnectTransfer(stripe, order.stripeSellerTransferId);
  }

  await prisma.$transaction(async (tx) => {
    await tx.storeOrder.update({
      where: { id: order.id },
      data: {
        status: "refunded",
        inventoryRestoredAt: new Date(),
        cancelReason: order.cancelReason ?? "Refunded in Stripe",
      },
    });
    await restockOrderLinesAfterReturn(tx, order.items);
    await debitSellerLedgerForRefund(tx, order);
  });
  await Promise.all(order.items.map((oi) => syncInventoryToChannelsAfterSale(oi.storeItemId)));
  return true;
}
