import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await prisma.subscription.findFirst({
    where: {
      memberId: userId,
      plan: "seller",
      status: "active",
    },
  });
  if (!sub) {
    return NextResponse.json(
      { error: "Seller plan required to list items" },
      { status: 403 }
    );
  }

  const member = await prisma.member.findUnique({
    where: { id: userId },
    select: { stripeConnectAccountId: true, firstName: true, lastName: true, email: true },
  });
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  let accountId = member.stripeConnectAccountId;

  try {
    if (!accountId) {
      if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === "sk_test_...") {
        return NextResponse.json(
          { error: "Stripe is not configured. Add STRIPE_SECRET_KEY to .env for storefront payments." },
          { status: 503 }
        );
      }
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: member.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      accountId = account.id;
      await prisma.member.update({
        where: { id: userId },
        data: { stripeConnectAccountId: accountId },
      });
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${BASE_URL}/seller-hub/store?refresh=1`,
      return_url: `${BASE_URL}/seller-hub/store?success=1`,
      type: "account_onboarding",
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Stripe setup failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
