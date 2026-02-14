import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const member = await prisma.member.findUnique({
    where: { id: userId },
    select: { stripeConnectAccountId: true },
  });

  if (!member?.stripeConnectAccountId) {
    return NextResponse.json({
      onboarded: false,
      accountId: null,
      chargesEnabled: false,
    });
  }

  try {
    const account = await stripe.accounts.retrieve(member.stripeConnectAccountId);
    const chargesEnabled = account.charges_enabled ?? false;
    return NextResponse.json({
      onboarded: chargesEnabled,
      accountId: member.stripeConnectAccountId,
      chargesEnabled,
    });
  } catch {
    return NextResponse.json({
      onboarded: false,
      accountId: member.stripeConnectAccountId,
      chargesEnabled: false,
    });
  }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    const isConn = /P1001|ECONNREFUSED|connect/i.test(String(e));
    return NextResponse.json(
      { error: isConn ? "Database connection failed. Make sure PostgreSQL is running." : msg },
      { status: 500 }
    );
  }
}
