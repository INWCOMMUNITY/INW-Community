import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { deactivateActiveListingsIfMemberLacksConnect } from "@/lib/store-listing-stripe-rules";
import { jsonIfCutoverBlocked } from "@/lib/commerce-foundation-cutover-http";
import { createMarketplaceStripe } from "@/lib/stripe-clients";
import { retrieveConnectAccountOrHeal } from "@/lib/stripe-connect-account-gone";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const member = await prisma.member.findUnique({
      where: { id: userId },
      select: { stripeConnectAccountId: true, email: true },
    });

    if (!member?.stripeConnectAccountId) {
      try {
        await deactivateActiveListingsIfMemberLacksConnect(userId);
      } catch (e) {
        const cutover = jsonIfCutoverBlocked(e);
        if (cutover) return cutover;
        throw e;
      }
      return NextResponse.json({
        onboarded: false,
        accountId: null,
        chargesEnabled: false,
      });
    }

    const stripe = createMarketplaceStripe();
    const result = await retrieveConnectAccountOrHeal({
      stripe,
      memberId: userId,
      email: member.email,
      accountId: member.stripeConnectAccountId,
    });

    if (result.ok) {
      const chargesEnabled = result.account.charges_enabled ?? false;
      return NextResponse.json({
        onboarded: chargesEnabled,
        accountId: result.accountId,
        chargesEnabled,
      });
    }

    // Transient Stripe errors: keep the stored link so listing is not blocked.
    if (!result.cleared) {
      return NextResponse.json({
        onboarded: true,
        accountId: member.stripeConnectAccountId,
        chargesEnabled: true,
        statusDegraded: true,
      });
    }

    // Confirmed gone and nothing to reattach — end active listings once.
    try {
      await deactivateActiveListingsIfMemberLacksConnect(userId);
    } catch (e) {
      const cutover = jsonIfCutoverBlocked(e);
      if (cutover) return cutover;
      throw e;
    }
    return NextResponse.json({
      onboarded: false,
      accountId: null,
      chargesEnabled: false,
    });
  } catch (e) {
    const cutover = jsonIfCutoverBlocked(e);
    if (cutover) return cutover;
    const msg = e instanceof Error ? e.message : "Database error";
    const isConn = /P1001|ECONNREFUSED|connect/i.test(String(e));
    return NextResponse.json(
      { error: isConn ? "Database connection failed. Make sure PostgreSQL is running." : msg },
      { status: 500 }
    );
  }
}
