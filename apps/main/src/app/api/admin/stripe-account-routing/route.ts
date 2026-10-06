import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAdmin } from "@/lib/admin-auth";
import {
  describeSecretKeyShape,
  isUsableSecretKey,
  resolveMarketplaceStripeSecretKey,
  STRIPE_API_VERSION,
} from "@/lib/stripe-secret-key";

async function accountFromSecret(secret: string | null): Promise<{
  ok: boolean;
  accountId: string | null;
  businessName: string | null;
  error: string | null;
}> {
  if (!secret) {
    return { ok: false, accountId: null, businessName: null, error: "secret_missing_or_unusable" };
  }
  try {
    const stripe = new Stripe(secret, { apiVersion: STRIPE_API_VERSION });
    const account = await stripe.accounts.retrieve();
    return {
      ok: true,
      accountId: account.id,
      businessName: account.business_profile?.name ?? account.settings?.dashboard?.display_name ?? null,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      accountId: null,
      businessName: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Admin-only: prove which Stripe platform account each Production secret authenticates as.
 * Never returns secret values — only account ids, names, and key shape (prefix/length/last4).
 */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const billingRaw = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const marketplaceRaw = process.env.STRIPE_MARKETPLACE_SECRET_KEY?.trim() ?? "";
  const resolvedMarketplace = resolveMarketplaceStripeSecretKey();

  const billingShape = describeSecretKeyShape(billingRaw);
  const marketplaceShape = describeSecretKeyShape(marketplaceRaw);
  const resolvedShape = describeSecretKeyShape(resolvedMarketplace);

  const [billingAccount, marketplaceRawAccount, resolvedMarketplaceAccount] = await Promise.all([
    accountFromSecret(isUsableSecretKey(billingRaw) ? billingRaw : null),
    accountFromSecret(isUsableSecretKey(marketplaceRaw) ? marketplaceRaw : null),
    accountFromSecret(resolvedMarketplace),
  ]);

  const sameAsBilling =
    Boolean(billingAccount.accountId) &&
    billingAccount.accountId === resolvedMarketplaceAccount.accountId;

  return NextResponse.json({
    vercelEnv: process.env.VERCEL_ENV ?? null,
    expected: {
      billingAccountId: "acct_1SvlAKBGz6ld2lSC",
      marketplaceAccountId: "acct_1UNaLdPWMd0Cau3q",
    },
    keys: {
      STRIPE_SECRET_KEY: billingShape,
      STRIPE_MARKETPLACE_SECRET_KEY: marketplaceShape,
      resolvedMarketplaceSecret: resolvedShape,
    },
    accounts: {
      billing: billingAccount,
      marketplaceEnvVar: marketplaceRawAccount,
      resolvedForStorefrontAndConnect: resolvedMarketplaceAccount,
    },
    diagnosis: {
      marketplaceEnvPresent: marketplaceShape.present,
      marketplaceEnvUsable: marketplaceShape.usable,
      resolvedFallsBackToBillingSecret:
        marketplaceShape.present === false && resolvedShape.present === true,
      storefrontWouldChargeSameAccountAsBilling: sameAsBilling,
      storefrontWouldChargeExpectedMarketplace:
        resolvedMarketplaceAccount.accountId === "acct_1UNaLdPWMd0Cau3q",
      publishableKeys: {
        billing: describeSecretKeyShape(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
        marketplace: describeSecretKeyShape(process.env.NEXT_PUBLIC_STRIPE_MARKETPLACE_PUBLISHABLE_KEY),
      },
    },
  });
}
