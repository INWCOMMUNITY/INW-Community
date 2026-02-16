import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getStripeCheckoutBranding } from "@/lib/stripe-branding";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

type BillingInterval = "monthly" | "yearly";

const PLANS: Record<
  string,
  { priceId: string; priceIdYearly?: string }
> = {
  subscribe: {
    priceId: process.env.STRIPE_PRICE_SUBSCRIBE ?? "",
    priceIdYearly: process.env.STRIPE_PRICE_SUBSCRIBE_YEARLY ?? "",
  },
  sponsor: {
    priceId: process.env.STRIPE_PRICE_SPONSOR ?? "",
    priceIdYearly: process.env.STRIPE_PRICE_SPONSOR_YEARLY ?? "",
  },
  seller: {
    priceId: process.env.STRIPE_PRICE_SELLER ?? "",
    priceIdYearly: process.env.STRIPE_PRICE_SELLER_YEARLY ?? "",
  },
};

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const planId = body.planId as string;
    const interval = (body.interval as BillingInterval) || "monthly";
    const businessData = body.businessData as Record<string, unknown> | undefined;
    // Mobile can pass returnBaseUrl so redirect works on device (e.g. http://192.168.1.140:3000)
    const returnBase = (body.returnBaseUrl as string)?.trim?.();
    const baseUrl = returnBase || process.env.NEXTAUTH_URL ?? "";
    const plan = PLANS[planId];
    const priceId = interval === "yearly" && plan?.priceIdYearly ? plan.priceIdYearly : plan?.priceId;
    if (!priceId) {
      return NextResponse.json(
        { error: interval === "yearly" ? "Yearly plan not configured" : "Invalid plan or Stripe not configured" },
        { status: 400 }
      );
    }
    const metadata: Record<string, string> = {
      memberId: session.user.id,
      planId,
    };
    if (
      (planId === "sponsor" || planId === "seller") &&
      businessData &&
      typeof businessData === "object" &&
      Object.keys(businessData).length > 0
    ) {
      metadata.businessData = JSON.stringify(businessData);
    }
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      customer_email: session.user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/my-community?success=1`,
      cancel_url: `${baseUrl}/support-nwc?canceled=1`,
      metadata,
    };
    const branding = getStripeCheckoutBranding();
    const createParams = { ...params, ...(branding && { branding_settings: branding }) };
    const checkout = await stripe.checkout.sessions.create(
      createParams as Stripe.Checkout.SessionCreateParams
    );
    if (!checkout.url) {
      console.error("[stripe/checkout] No URL in checkout session:", checkout.id);
      return NextResponse.json({ error: "Checkout could not be created" }, { status: 500 });
    }
    return NextResponse.json({ url: checkout.url });
  } catch (e) {
    console.error("[stripe/checkout]", e);
    return NextResponse.json({ error: "Checkout failed. Please try again." }, { status: 500 });
  }
}
