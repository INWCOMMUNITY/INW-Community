import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prismaWhereMemberSellerOrSubscribeAccess } from "@/lib/nwc-paid-subscription";
import { createMarketplaceStripe } from "@/lib/stripe-clients";
import {
  collectKnownConnectAccountIdsForMember,
  ensureConnectAccountMemberMetadata,
  findExistingConnectAccountIdForEmail,
  maybeDeleteEmptyDuplicateConnectAccount,
} from "@/lib/stripe-connect-reuse-account";

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

  const member = await prisma.member.findUnique({
    where: { id: userId },
    select: { stripeConnectAccountId: true, email: true },
  });
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const stripe = createMarketplaceStripe();

  let accountId = member.stripeConnectAccountId?.trim() || null;

  try {
    const knownAccountIds = await collectKnownConnectAccountIdsForMember(prisma, stripe, userId).catch(
      () => [] as string[]
    );
    const preferredId = await findExistingConnectAccountIdForEmail(stripe, member.email, {
      memberId: userId,
      knownAccountIds,
    }).catch(() => null);

    // Only heal when already linked (avoid undoing an intentional disconnect).
    if (accountId && preferredId && preferredId !== accountId) {
      const emptyDuplicateId = accountId;
      accountId = preferredId;
      await prisma.member.update({
        where: { id: userId },
        data: { stripeConnectAccountId: accountId },
      });
      await ensureConnectAccountMemberMetadata(stripe, accountId, userId);
      await maybeDeleteEmptyDuplicateConnectAccount(stripe, emptyDuplicateId, accountId);
    }

    if (!accountId) {
      return NextResponse.json(
        { error: "Complete Stripe Connect setup first" },
        { status: 400 }
      );
    }

    await ensureConnectAccountMemberMetadata(stripe, accountId, userId);
    const loginLink = await stripe.accounts.createLoginLink(accountId);
    return NextResponse.json({ url: loginLink.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create dashboard link";
    const accountGone = /no such account|account.*doesn't exist|account.*does not exist|invalid id/i.test(msg);
    if (accountGone) {
      await prisma.member.update({
        where: { id: userId },
        data: { stripeConnectAccountId: null },
      });
      return NextResponse.json(
        { error: "Your previous Stripe account is no longer available. Please complete setup again." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
