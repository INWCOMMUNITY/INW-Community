import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { resolveAllowedCheckoutBaseUrl } from "@/lib/checkout-base-url";
import { prismaWhereMemberSellerOrSubscribeAccess } from "@/lib/nwc-paid-subscription";
import { createMarketplaceStripe } from "@/lib/stripe-clients";
import {
  collectKnownConnectAccountIdsForMember,
  ensureConnectAccountMemberMetadata,
  findExistingConnectAccountIdForEmail,
  maybeDeleteEmptyDuplicateConnectAccount,
} from "@/lib/stripe-connect-reuse-account";
import {
  resolveMarketplaceStripeSecretKey,
  STRIPE_MARKETPLACE_NOT_CONFIGURED_MESSAGE,
} from "@/lib/stripe-secret-key";

/** Paths allowed as Stripe return targets for the native app bridge (`/app/stripe-connect-return`). */
function sanitizeMobileStripeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.trim().split("?")[0]?.split("#")[0] ?? "";
  if (!path.startsWith("/") || path.includes("..") || path.includes("//")) return null;
  if (!/^\/seller-hub(\/|$)/.test(path)) return null;
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

function isNoSuchAccount(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no such account|account.*doesn't exist|account.*does not exist|invalid id/i.test(msg);
}

function accountIsReadyForReuse(account: Stripe.Account): boolean {
  return account.details_submitted === true || account.charges_enabled === true || account.payouts_enabled === true;
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

  if (!resolveMarketplaceStripeSecretKey()) {
    return NextResponse.json(
      { error: STRIPE_MARKETPLACE_NOT_CONFIGURED_MESSAGE },
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

  const stripe = createMarketplaceStripe();

  let accountId = member.stripeConnectAccountId;
  const previouslyLinkedId = accountId;

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

    const knownAccountIds = await collectKnownConnectAccountIdsForMember(prisma, stripe, userId).catch(
      (err) => {
        console.warn("[stripe/connect/onboard] known Connect id lookup failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return [] as string[];
      }
    );

    // Prefer an existing marketplace Express account (by balance / history) even if
    // the member is already linked to a newer empty duplicate.
    const preferredId = await findExistingConnectAccountIdForEmail(stripe, member.email, {
      memberId: userId,
      knownAccountIds,
    }).catch((err) => {
      console.warn("[stripe/connect/onboard] reuse lookup failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });

    if (preferredId && preferredId !== accountId) {
      console.info("[stripe/connect/onboard] reattaching preferred Connect account", {
        memberId: userId,
        previousAccountId: accountId,
        preferredAccountId: preferredId,
        knownAccountIds,
      });
      const emptyDuplicateId = accountId;
      accountId = preferredId;
      await prisma.member.update({
        where: { id: userId },
        data: { stripeConnectAccountId: accountId },
      });
      await ensureConnectAccountMemberMetadata(stripe, accountId, userId);
      await maybeDeleteEmptyDuplicateConnectAccount(stripe, emptyDuplicateId, accountId);
    } else if (preferredId && preferredId === accountId) {
      await ensureConnectAccountMemberMetadata(stripe, accountId, userId);
    }

    if (!accountId) {
      // True first-time seller on this marketplace platform only.
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: member.email,
        business_type: "individual",
        metadata: { memberId: userId },
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
    }

    const account = await stripe.accounts.retrieve(accountId);

    // Existing funded / completed Express account: reconnect in-app only.
    // Do not send them through Account Link onboarding (that path created empty duplicates
    // when Stripe identity login landed on a different Express profile).
    if (accountIsReadyForReuse(account)) {
      await ensureConnectAccountMemberMetadata(stripe, accountId, userId);
      if (previouslyLinkedId && previouslyLinkedId !== accountId) {
        await maybeDeleteEmptyDuplicateConnectAccount(stripe, previouslyLinkedId, accountId);
      }
      console.info("[stripe/connect/onboard] reused existing Connect account without new onboarding", {
        memberId: userId,
        accountId,
      });
      return NextResponse.json({
        url: return_url,
        reused: true,
        accountId,
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
        const existingId = await findExistingConnectAccountIdForEmail(stripe, member.email, {
          memberId: userId,
          knownAccountIds,
        }).catch(() => null);
        if (existingId) {
          accountId = existingId;
        } else {
          const created = await stripe.accounts.create({
            type: "express",
            country: "US",
            email: member.email,
            business_type: "individual",
            metadata: { memberId: userId },
            capabilities: {
              card_payments: { requested: true },
              transfers: { requested: true },
            },
          });
          accountId = created.id;
          if (member.firstName?.trim() || member.lastName?.trim()) {
            await stripe.accounts.createPerson(accountId, {
              first_name: (member.firstName ?? "").trim() || undefined,
              last_name: (member.lastName ?? "").trim() || undefined,
              relationship: { representative: true },
            });
          }
        }
        await prisma.member.update({
          where: { id: userId },
          data: { stripeConnectAccountId: accountId },
        });
        await ensureConnectAccountMemberMetadata(stripe, accountId, userId);

        const recovered = await stripe.accounts.retrieve(accountId);
        if (accountIsReadyForReuse(recovered)) {
          return NextResponse.json({
            url: return_url,
            reused: true,
            accountId,
          });
        }

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
