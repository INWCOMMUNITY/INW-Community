import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  clampSellerOnboardingStep,
  getSellerOnboardingProgress,
} from "@/lib/seller-onboarding-progress";

export const dynamic = "force-dynamic";

/** Beans: remove this cookie skip with the localhost shipping and Stripe continues. */
function localOnboardingSkip(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  const host = (req.headers.get("host") ?? "").split(":")[0];
  if (host !== "localhost" && host !== "127.0.0.1") return false;
  return req.cookies.get("nwc_local_onboarding_skip")?.value === "1";
}

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) {
    return NextResponse.json({ loggedIn: false, step: "account", resumePath: null, onboardingStep: null });
  }

  const [progress, etsy, shopify] = await Promise.all([
    getSellerOnboardingProgress(memberId, {
      localSkipShippingAndStripe: localOnboardingSkip(req),
    }),
    prisma.etsyConnection.findFirst({
      where: { memberId, status: "ACTIVE" },
      select: { id: true, shopName: true },
    }),
    prisma.shopifyConnection.findFirst({
      where: { memberId, status: "ACTIVE" },
      select: { id: true, shopDomain: true },
    }),
  ]);

  const step = clampSellerOnboardingStep(
    progress.furthest,
    req.nextUrl.searchParams.get("requested"),
    progress.hasSubscription
  );

  return NextResponse.json({
    loggedIn: true,
    step,
    resumePath: progress.resumePath,
    onboardingStep: progress.onboardingStep,
    hasBusiness: progress.hasBusiness,
    hasSubscription: progress.hasSubscription,
    shippoConnected: progress.shippoConnected,
    shippingOptionCount: progress.shippingOptionCount,
    stripeConnectStarted: progress.stripeConnectStarted,
    etsyConnected: Boolean(etsy),
    etsyShopName: etsy?.shopName ?? null,
    shopifyConnected: Boolean(shopify),
    shopifyShopDomain: shopify?.shopDomain ?? null,
    firstName: progress.firstName,
    lastName: progress.lastName,
    phone: progress.phone,
  });
}
