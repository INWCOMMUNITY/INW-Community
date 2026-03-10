import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getBaseUrl } from "@/lib/get-base-url";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

export async function POST(req: NextRequest) {
  let baseUrl = getBaseUrl();
  try {
    const body = await req.json();
    const returnBase = (body.returnBaseUrl as string)?.trim?.();
    if (returnBase) baseUrl = returnBase;
  } catch {
    // use default
  }
  baseUrl = baseUrl.trim().replace(/\/$/, "") || getBaseUrl();

  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === "sk_test_...") {
    return NextResponse.json(
      { error: "Stripe is not configured. Add STRIPE_SECRET_KEY to .env for storefront payments." },
      { status: 503 }
    );
  }

  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await prisma.subscription.findFirst({
    where: {
      memberId: userId,
      plan: { in: ["seller", "subscribe"] },
      status: "active",
    },
  });
  if (!sub) {
    return NextResponse.json(
      { error: "Seller or Subscribe plan required for payouts" },
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

  const isNoSuchAccount = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    return /no such account|account.*doesn't exist|account.*does not exist|invalid id/i.test(msg);
  };

  let accountId = member.stripeConnectAccountId;

  try {
    if (accountId) {
      try {
        await stripe.accounts.retrieve(accountId);
      } catch (retrieveErr) {
        if (isNoSuchAccount(retrieveErr)) {
          await prisma.member.update({
            where: { id: userId },
            data: { stripeConnectAccountId: null },
          });
          accountId = null;
        } else {
          throw retrieveErr;
        }
      }
    }

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: member.email,
        business_type: "individual",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      accountId = account.id;
      // Prefill representative so Stripe doesn't ask for name again during onboarding
      if (member.firstName?.trim() || member.lastName?.trim()) {
        await stripe.accounts.createPerson(accountId, {
          first_name: (member.firstName ?? "").trim() || undefined,
          last_name: (member.lastName ?? "").trim() || undefined,
          relationship: { representative: true },
        });
      }
      await prisma.member.update({
        where: { id: userId },
        data: { stripeConnectAccountId: accountId },
      });
    }

    let accountLink: Stripe.AccountLink;
    try {
      accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${baseUrl}/seller-hub/store/payouts?refresh=1`,
        return_url: `${baseUrl}/seller-hub/store/payouts?success=1`,
        type: "account_onboarding",
        collection_options: {
          fields: "currently_due",
          future_requirements: "omit",
        },
      });
    } catch (linkErr) {
      if (isNoSuchAccount(linkErr)) {
        await prisma.member.update({
          where: { id: userId },
          data: { stripeConnectAccountId: null },
        });
        const account = await stripe.accounts.create({
          type: "express",
          country: "US",
          email: member.email,
          business_type: "individual",
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
        });
        accountId = account.id;
        if (member.firstName?.trim() || member.lastName?.trim()) {
          await stripe.accounts.createPerson(accountId, {
            first_name: (member.firstName ?? "").trim() || undefined,
            last_name: (member.lastName ?? "").trim() || undefined,
            relationship: { representative: true },
          });
        }
        await prisma.member.update({
          where: { id: userId },
          data: { stripeConnectAccountId: accountId },
        });
        accountLink = await stripe.accountLinks.create({
          account: accountId,
          refresh_url: `${baseUrl}/seller-hub/store/payouts?refresh=1`,
          return_url: `${baseUrl}/seller-hub/store/payouts?success=1`,
          type: "account_onboarding",
          collection_options: {
            fields: "currently_due",
            future_requirements: "omit",
          },
        });
      } else {
        throw linkErr;
      }
    }

    return NextResponse.json({ url: accountLink.url });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    // Stripe returns an error about "responsibilities for managing losses" until the platform
    // completes Connect settings: https://dashboard.stripe.com/settings/connect/platform-profile
    const isPlatformProfileError =
      /responsibilities|platform-profile|managing losses|connect.*profile/i.test(raw);
    const error = isPlatformProfileError
      ? "Payment setup is not available yet. The platform needs to complete Stripe Connect configuration in the Dashboard. Please try again later or contact support."
      : raw;
    return NextResponse.json({ error }, { status: 500 });
  }
}
