import Stripe from "stripe";
import { prisma } from "database";

/** Sum USD payouts that have already landed in the seller’s bank (`status: paid`). */
export async function sumPaidConnectPayoutsCents(
  stripe: Stripe,
  connectAccountId: string
): Promise<number> {
  let total = 0;
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.payouts.list(
      {
        status: "paid",
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      { stripeAccount: connectAccountId }
    );
    for (const p of page.data) {
      if (p.currency !== "usd") continue;
      total += p.amount;
    }
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1]!.id;
  }
  return total;
}

/**
 * Record a Connect bank payout on the internal seller ledger (idempotent by payout id).
 * Display totals should still come from Stripe; this keeps transaction history in sync
 * for both Send to Bank and Stripe automatic payouts.
 */
export async function recordConnectPayoutInLedger(args: {
  memberId: string;
  payoutId: string;
  amountCents: number;
}): Promise<boolean> {
  const { memberId, payoutId, amountCents } = args;
  if (amountCents <= 0) return false;

  const existing = await prisma.sellerBalanceTransaction.findFirst({
    where: { memberId, type: "payout", stripeTransferId: payoutId },
    select: { id: true },
  });
  if (existing) return false;

  await prisma.sellerBalance.upsert({
    where: { memberId },
    create: {
      memberId,
      balanceCents: 0,
      totalEarnedCents: 0,
      totalPaidOutCents: amountCents,
    },
    update: {
      balanceCents: { decrement: amountCents },
      totalPaidOutCents: { increment: amountCents },
    },
  });
  await prisma.sellerBalanceTransaction.create({
    data: {
      memberId,
      type: "payout",
      amountCents: -amountCents,
      stripeTransferId: payoutId,
      description: "Payout to bank",
    },
  });
  return true;
}

export function expectedSellerTransferCents(order: {
  totalCents: number;
  subtotalCents: number;
  platformFeeCents?: number | null;
  salesTaxReserveCents?: number | null;
}): number {
  if (
    typeof order.platformFeeCents === "number" &&
    typeof order.salesTaxReserveCents === "number"
  ) {
    return Math.max(0, order.totalCents - order.platformFeeCents - order.salesTaxReserveCents);
  }
  return Math.max(0, order.totalCents - Math.floor(order.subtotalCents * 0.01));
}
