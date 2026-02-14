import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

const PLANS: Record<string, { priceId: string; trialDays?: number }> = {
  subscribe: { priceId: process.env.STRIPE_PRICE_SUBSCRIBE ?? "" },
  sponsor: { priceId: process.env.STRIPE_PRICE_SPONSOR ?? "", trialDays: 45 },
  seller: { priceId: process.env.STRIPE_PRICE_SELLER ?? "", trialDays: 60 },
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const planId = body.planId as string;
    const plan = PLANS[planId];
    if (!plan?.priceId) {
      return NextResponse.json({ error: "Invalid plan or Stripe not configured" }, { status: 400 });
    }
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      customer_email: session.user.email,
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${process.env.NEXTAUTH_URL ?? ""}/my-community?success=1`,
      cancel_url: `${process.env.NEXTAUTH_URL ?? ""}/support-nwc?canceled=1`,
      metadata: { memberId: session.user.id, planId },
    };
    if (plan.trialDays) {
      params.subscription_data = { trial_period_days: plan.trialDays };
    }
    const checkout = await stripe.checkout.sessions.create(params);
    return NextResponse.json({ url: checkout.url });
  } catch (e) {
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 });
  }
}
