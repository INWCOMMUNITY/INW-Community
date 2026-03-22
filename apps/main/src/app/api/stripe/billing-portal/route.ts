import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSessionForApi } from "@/lib/mobile-auth";
import { resolveAllowedCheckoutBaseUrl } from "@/lib/checkout-base-url";
import { resolveStripeCustomerIdForMember } from "@/lib/stripe-customer-for-member";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

/** Creates a Stripe Billing Portal session so the customer lands on their subscriptions (all active subs on the same Stripe Customer). */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let requestedReturn: string | undefined;
  try {
    const body = await req.json();
    if (typeof body.returnBaseUrl === "string") requestedReturn = body.returnBaseUrl;
  } catch {
    // use default
  }
  const baseUrl = resolveAllowedCheckoutBaseUrl(requestedReturn);
  try {
    const customerId = await resolveStripeCustomerIdForMember(session.user.id);
    if (!customerId) {
      return NextResponse.json(
        { error: "No billing account found. Subscribe first, then you can manage active subscriptions here." },
        { status: 400 }
      );
    }
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/my-community/subscriptions`,
    });
    if (!portalSession.url) {
      return NextResponse.json({ error: "Could not create billing portal session" }, { status: 500 });
    }
    return NextResponse.json({ url: portalSession.url });
  } catch (e) {
    console.error("[billing-portal]", e);
    return NextResponse.json(
      { error: "Could not open billing portal. Please try again or contact support." },
      { status: 500 }
    );
  }
}
