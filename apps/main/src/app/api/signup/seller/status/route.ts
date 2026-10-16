import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import {
  clampSellerOnboardingStep,
  getSellerOnboardingProgress,
} from "@/lib/seller-onboarding-progress";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) {
    return NextResponse.json({ loggedIn: false, step: "account", resumePath: null, onboardingStep: null });
  }

  const enter = req.nextUrl.searchParams.get("enter");
  if (enter === "seller" || enter === "business") {
    const keepSellerIntent =
      enter === "business"
        ? await prisma.subscription.findFirst({
            where: prismaWhereMemberSellerPlanAccess(memberId),
            select: { id: true },
          })
        : null;
    if (!keepSellerIntent) {
      await prisma.member.update({
        where: { id: memberId },
        data: { signupIntent: enter },
      });
    }
  }

  const [progress, etsy, shopify] = await Promise.all([
    getSellerOnboardingProgress(memberId),
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
