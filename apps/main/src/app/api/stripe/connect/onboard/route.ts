import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { resolveAllowedCheckoutBaseUrl } from "@/lib/checkout-base-url";
import { prismaWhereMemberSellerOrSubscribeAccess } from "@/lib/nwc-paid-subscription";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

/** Paths allowed as Stripe return targets for the native app bridge (`/app/stripe-connect-return`). */
function sanitizeMobileStripeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.trim().split("?")[0]?.split("#")[0] ?? "";
  if (!path.startsWith("/") || path.includes("..") || path.includes("//")) return null;
  if (!/^\/(seller-hub|resale-hub)(\/|$)/.test(path)) return null;
  return path;
}

function stripeConnectAccountLinkUrls(baseUrl: string, mobilePath: string | null): { return_url: string; refresh_url: string } {
  const payouts = `${baseUrl}/seller-hub/store/payouts`;
  if (!mobilePath) {
    return {
      return_url: `${payouts}?success=1`,
      refresh_url: `${payouts}?refresh=1`,
    };
  }
  const enc = encodeURIComponent(mobilePath);
  return {
    return_url: `${baseUrl}/app/stripe-connect-return?path=${enc}&success=1`,
    refresh_url: `${baseUrl}/app/stripe-connect-return?path=${enc}&refresh=1`,
  };
}

export async function POST(req: NextRequest) {
  let requestedReturn: string | undefined;
  let mobileReturnPath: string | null = null;
  try {
    const body = await req.json();
    if (typeof body.returnBaseUrl === "string") requestedReturn = body.returnBaseUrl;
    mobileReturnPath = sanitizeMobileStripeReturnPath(body.mobileReturnPath);
  } catch {
    // no JSON body
  }
  const baseUrl = resolveAllowedCheckoutBaseUrl(requestedReturn);
  const { return_url, refresh_url } = stripeConnectAccountLinkUrls(baseUrl, mobileReturnPath);

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
    where: prismaWhereMemberSellerOrSubscribeAccess(userId),
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
        refresh_url,
        return_url,
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
          refresh_url,
          return_url,
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
