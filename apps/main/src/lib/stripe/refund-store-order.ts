import Stripe from "stripe";
import { prisma } from "database";
import { restockOrderLinesAfterReturn } from "@/lib/store-item-restock";
import { syncInventoryToChannelsAfterSale } from "@/lib/channels/sync-inventory";
import { computeSellerTransferCents } from "@/lib/storefront-payout";

export function refundAmountCents(order: { totalCents: number; taxCents?: number | null }): number {
  return Math.max(0, order.totalCents + (order.taxCents ?? 0));
}

export function sellerLedgerDebitCents(order: {
  totalCents: number;
  subtotalCents: number;
}): number {
  return computeSellerTransferCents(order.totalCents, order.subtotalCents).sellerTransferCents;
}

async function reverseConnectTransfer(stripe: Stripe, transferId: string): Promise<void> {
  try {
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
  order: { id: string; sellerId: string; totalCents: number; subtotalCents: number }
): Promise<void> {
  const debit = sellerLedgerDebitCents(order);
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
 * reverse the Connect transfer when present, restock, and flip sold_out → active.
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
}): Promise<{ ok: true; refunded: true } | { ok: false; error: string; status: number }> {
  const { stripe, order } = args;
  if (order.status === "refunded") {
    return { ok: false, error: "Order already refunded", status: 400 };
  }
  if (!order.stripePaymentIntentId) {
    return { ok: false, error: "Order has no payment to refund", status: 400 };
  }

  if (order.stripeSellerTransferId) {
    try {
      await reverseConnectTransfer(stripe, order.stripeSellerTransferId);
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Could not reverse seller transfer",
        status: 500,
      };
    }
  }

  const amount = refundAmountCents(order);
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

  await prisma.$transaction(async (tx) => {
    await tx.storeOrder.update({
      where: { id: order.id },
      data: {
        status: "refunded",
        cancelReason: args.reason,
        cancelNote: args.note ?? undefined,
        inventoryRestoredAt: new Date(),
      },
    });
    await restockOrderLinesAfterReturn(tx, order.items);
    await debitSellerLedgerForRefund(tx, order);
  });

  await Promise.all(order.items.map((oi) => syncInventoryToChannelsAfterSale(oi.storeItemId)));
  return { ok: true, refunded: true };
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
