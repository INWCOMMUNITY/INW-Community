import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prisma } from "database";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

/** Creates a Stripe Billing Portal session for the logged-in user to manage subscription, payment methods, and cancel. */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let baseUrl = process.env.NEXTAUTH_URL ?? "https://inwcommunity.com";
  try {
    const body = await req.json();
    const returnBase = (body.returnBaseUrl as string)?.trim?.();
    if (returnBase) baseUrl = returnBase;
  } catch {
    // use default
  }
  try {
    const sub = await prisma.subscription.findFirst({
      where: { memberId: session.user.id, status: "active" },
      orderBy: { createdAt: "desc" },
      select: { stripeCustomerId: true },
    });
    const customerId = sub?.stripeCustomerId;
    if (!customerId) {
      return NextResponse.json(
        { error: "No active subscription found. You can manage your subscription after subscribing." },
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
