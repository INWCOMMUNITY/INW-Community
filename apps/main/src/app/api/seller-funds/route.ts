import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prismaWhereMemberSellerOrSubscribeAccess } from "@/lib/nwc-paid-subscription";
import {
  recordConnectPayoutInLedger,
  sumPaidConnectPayoutsCents,
} from "@/lib/stripe/connect-payouts";
import { createMarketplaceStripe } from "@/lib/stripe-clients";
import {
  collectKnownConnectAccountIdsForMember,
  ensureConnectAccountMemberMetadata,
  findExistingConnectAccountIdForEmail,
  maybeDeleteEmptyDuplicateConnectAccount,
} from "@/lib/stripe-connect-reuse-account";
import { computeSellerTransferCents } from "@/lib/storefront-payout";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSellerOrSubscribeAccess(userId),
  });
  if (!sub) {
    return NextResponse.json({ error: "Seller or Subscribe plan required" }, { status: 403 });
  }

  const stripe = createMarketplaceStripe();

  const balance = await prisma.sellerBalance.findUnique({
    where: { memberId: userId },
  });
  const transactions = await prisma.sellerBalanceTransaction.findMany({
    where: { memberId: userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const member = await prisma.member.findUnique({
    where: { id: userId },
    select: { stripeConnectAccountId: true, email: true },
  });

  // If reconnect linked an empty duplicate, swap to the funded Express account.
  // Do not auto-attach when Connect is intentionally disconnected (id is null).
  if (member?.stripeConnectAccountId) {
    try {
      const knownAccountIds = await collectKnownConnectAccountIdsForMember(prisma, stripe, userId);
      const preferredId = await findExistingConnectAccountIdForEmail(stripe, member.email, {
        memberId: userId,
        knownAccountIds,
      });
      if (preferredId && preferredId !== member.stripeConnectAccountId) {
        const emptyDuplicateId = member.stripeConnectAccountId;
        await prisma.member.update({
          where: { id: userId },
          data: { stripeConnectAccountId: preferredId },
        });
        member.stripeConnectAccountId = preferredId;
        await ensureConnectAccountMemberMetadata(stripe, preferredId, userId);
        await maybeDeleteEmptyDuplicateConnectAccount(stripe, emptyDuplicateId, preferredId);
      } else if (preferredId) {
        await ensureConnectAccountMemberMetadata(stripe, preferredId, userId);
      }
    } catch (healErr) {
      console.warn("[seller-funds] Connect reattach heal failed", {
        error: healErr instanceof Error ? healErr.message : String(healErr),
      });
    }
  }

  const orderIds = [
    ...new Set(
      transactions.map((t) => t.orderId).filter((id): id is string => Boolean(id?.trim()))
    ),
  ];
  const orders =
    orderIds.length > 0
      ? await prisma.storeOrder.findMany({
          where: { id: { in: orderIds }, sellerId: userId },
          select: {
            id: true,
            totalCents: true,
            subtotalCents: true,
            taxCents: true,
            platformFeeCents: true,
            salesTaxReserveCents: true,
          },
        })
      : [];
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const transactionsWithBreakdown = transactions.map((t) => {
    const order = t.orderId ? orderById.get(t.orderId) : undefined;
    if (!order || (t.type !== "sale" && t.type !== "return" && t.type !== "refund")) {
      return { ...t, breakdown: null as null };
    }
    const split = computeSellerTransferCents(
      order.totalCents,
      order.subtotalCents,
      order.taxCents ?? 0
    );
    return {
      ...t,
      breakdown: {
        itemAndShippingCents: order.totalCents,
        salesTaxCents: order.taxCents ?? 0,
        salesTaxReserveCents: order.salesTaxReserveCents,
        processingFeeCents: split.processingFeeCents,
        stripeTaxProductFeeCents: split.stripeTaxProductFeeCents,
        stripeFeesCents: split.processingFeeCents + split.stripeTaxProductFeeCents,
        optionalPlatformFeeCents: split.optionalPlatformFeeCents,
        sellerTransferCents: split.sellerTransferCents,
        note:
          "Sales tax collected from the buyer stays with the platform for remittance. Stripe fees (card processing ~2.9%+$0.30, plus Stripe Tax 0.5% when tax is collected) and the 1% sales tax reserve are withheld from your transfer.",
      },
    };
  });

  let hasStripeConnect = false;
  let availableForPayoutCents: number | undefined;
  let pendingCents: number | undefined;
  let payoutScheduleDescription: string | undefined;
  let totalPaidOutCents = balance?.totalPaidOutCents ?? 0;

  if (member?.stripeConnectAccountId) {
    try {
      const account = await stripe.accounts.retrieve(member.stripeConnectAccountId);
      hasStripeConnect = account.charges_enabled === true;
      const [stripeBalance, paidOutFromStripe] = await Promise.all([
        stripe.balance.retrieve({
          stripeAccount: member.stripeConnectAccountId,
        }),
        sumPaidConnectPayoutsCents(stripe, member.stripeConnectAccountId).catch(() => null),
      ]);
      if (paidOutFromStripe !== null) {
        totalPaidOutCents = paidOutFromStripe;
      }
      const usdAvailable = stripeBalance.available?.find((b) => b.currency === "usd");
      const usdPending = stripeBalance.pending?.find((b) => b.currency === "usd");
      availableForPayoutCents = usdAvailable?.amount ?? 0;
      pendingCents = usdPending?.amount ?? 0;
      const schedule = account.settings?.payouts?.schedule;
      if (schedule) {
        const delay = schedule.delay_days ?? 2;
        const interval = schedule.interval ?? "daily";
        if (interval === "daily") {
          payoutScheduleDescription =
            delay <= 0
              ? "Funds are available immediately"
              : `Funds typically available in ${delay} business day${delay === 1 ? "" : "s"}`;
        } else if (interval === "weekly" && schedule.weekly_anchor) {
          payoutScheduleDescription = `Payouts weekly on ${schedule.weekly_anchor}`;
        } else if (interval === "monthly") {
          payoutScheduleDescription = "Payouts monthly";
        } else {
          payoutScheduleDescription = `Funds typically available in ${delay} business days`;
        }
      } else {
        payoutScheduleDescription = "Funds typically available in 2 business days";
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const accountGone = /no such account|account.*doesn't exist|account.*does not exist|invalid id/i.test(msg);
      if (accountGone) {
        await prisma.member.update({
          where: { id: userId },
          data: { stripeConnectAccountId: null },
        }).catch(() => {});
      }
      hasStripeConnect = false;
    }
  }

  return NextResponse.json({
    balanceCents: balance?.balanceCents ?? 0,
    totalEarnedCents: balance?.totalEarnedCents ?? 0,
    totalPaidOutCents,
    transactions: transactionsWithBreakdown,
    hasStripeConnect,
    ...(availableForPayoutCents !== undefined && { availableForPayoutCents }),
    ...(pendingCents !== undefined && { pendingCents }),
    ...(payoutScheduleDescription !== undefined && { payoutScheduleDescription }),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSellerOrSubscribeAccess(userId),
  });
  if (!sub) {
    return NextResponse.json({ error: "Seller or Subscribe plan required" }, { status: 403 });
  }

  const stripe = createMarketplaceStripe();

  const member = await prisma.member.findUnique({
    where: { id: userId },
    select: { stripeConnectAccountId: true },
  });
  if (!member?.stripeConnectAccountId) {
    return NextResponse.json(
      { error: "Complete Stripe Connect setup to receive payouts" },
      { status: 400 }
    );
  }

  let availableCents: number;
  try {
    const stripeBalance = await stripe.balance.retrieve({
      stripeAccount: member.stripeConnectAccountId,
    });
    const usdAvailable = stripeBalance.available?.find((b) => b.currency === "usd");
    availableCents = usdAvailable?.amount ?? 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const accountGone = /no such account|account.*doesn't exist|account.*does not exist|invalid id/i.test(msg);
    if (accountGone) {
      await prisma.member.update({
        where: { id: userId },
        data: { stripeConnectAccountId: null },
      }).catch(() => {});
      return NextResponse.json(
        { error: "Your previous payment account is no longer available. Please complete setup again in Seller Hub → My Funds." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Could not load your Stripe balance" }, { status: 500 });
  }

  if (availableCents < 100) {
    return NextResponse.json(
      { error: "Minimum payout is $1.00. No funds available for payout yet." },
      { status: 400 }
    );
  }

  try {
    const payout = await stripe.payouts.create(
      {
        amount: availableCents,
        currency: "usd",
        metadata: { memberId: userId },
      },
      { stripeAccount: member.stripeConnectAccountId }
    );
    await recordConnectPayoutInLedger({
      memberId: userId,
      payoutId: payout.id,
      amountCents: availableCents,
    }).catch((ledgerErr) =>
      console.error("[seller-funds] ledger record after payout failed:", ledgerErr)
    );
    return NextResponse.json({ ok: true, payoutId: payout.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const accountGone = /no such account|account.*doesn't exist|account.*does not exist|invalid id/i.test(msg);
    if (accountGone) {
      await prisma.member.update({
        where: { id: userId },
        data: { stripeConnectAccountId: null },
      }).catch(() => {});
      return NextResponse.json(
        { error: "Your previous payment account is no longer available. Please complete setup again in Seller Hub → My Funds." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: msg || "Payout failed" }, { status: 500 });
  }
}
