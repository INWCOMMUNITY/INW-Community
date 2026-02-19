import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function createBusinessFromDraft(
  memberId: string,
  data: Record<string, unknown>
): Promise<void> {
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const city = typeof data.city === "string" ? data.city.trim() : "";
  const shortDescription = typeof data.shortDescription === "string" ? data.shortDescription.trim() : null;
  const fullDescription = typeof data.fullDescription === "string" ? data.fullDescription.trim() : null;
  const categories = Array.isArray(data.categories)
    ? (data.categories as string[]).filter((c) => typeof c === "string" && c.trim()).slice(0, 2)
    : [];

  if (!name || !city) return;
  if (categories.length === 0) return;

  const website = typeof data.website === "string" && data.website.trim()
    ? (data.website.startsWith("http") ? data.website : `https://${data.website}`)
    : null;
  const phone = typeof data.phone === "string" && data.phone.trim() ? data.phone.trim() : null;
  const email = typeof data.email === "string" && data.email.trim() ? data.email.trim() : null;
  const logoUrl = typeof data.logoUrl === "string" && data.logoUrl.trim() ? data.logoUrl.trim() : null;
  const address = typeof data.address === "string" && data.address.trim() ? data.address.trim() : null;
  const photos = Array.isArray(data.photos) ? (data.photos as string[]).filter(Boolean) : [];
  const hoursOfOperation = data.hoursOfOperation && typeof data.hoursOfOperation === "object"
    ? (data.hoursOfOperation as Record<string, string>)
    : undefined;

  const existingCount = await prisma.business.count({ where: { memberId } });
  if (existingCount >= 2) return;

  let slug = slugify(name);
  let suffix = 0;
  while (await prisma.business.findUnique({ where: { slug } })) {
    slug = `${slugify(name)}-${++suffix}`;
  }

  const business = await prisma.business.create({
    data: {
      memberId,
      name,
      shortDescription,
      fullDescription,
      website,
      phone,
      email,
      logoUrl,
      address,
      city,
      categories,
      slug,
      photos,
      hoursOfOperation,
    },
  });
  const { awardBusinessSignupBadges } = await import("@/lib/badge-award");
  awardBusinessSignupBadges(business.id).catch(() => {});
}

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey?.startsWith("sk_") || stripeSecretKey.includes("...")) {
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const planId = body.planId as string;
    const interval = (body.interval as BillingInterval) || "monthly";
    const businessData = body.businessData as Record<string, unknown> | undefined;

    const plan = PLANS[planId];
    const priceId = interval === "yearly" && plan?.priceIdYearly ? plan.priceIdYearly : plan?.priceId;
    if (!priceId) {
      return NextResponse.json(
        { error: interval === "yearly" ? "Yearly plan not configured" : "Invalid plan or Stripe not configured" },
        { status: 400 }
      );
    }

    if (planId !== "subscribe" && planId !== "sponsor" && planId !== "seller") {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const member = await prisma.member.findUnique({
      where: { id: session.user.id },
      select: { email: true, stripeCustomerId: true, firstName: true, lastName: true },
    });
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    let customerId = member.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: member.email,
        name: `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() || undefined,
      });
      customerId = customer.id;
      await prisma.member.update({
        where: { id: session.user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const existingSub = await prisma.subscription.findFirst({
      where: {
        memberId: session.user.id,
        plan: planId as "subscribe" | "sponsor" | "seller",
        status: { in: ["active", "trialing"] },
      },
    });
    if (existingSub) {
      return NextResponse.json(
        { error: "You already have an active subscription for this plan" },
        { status: 400 }
      );
    }

    const subscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: customerId,
      items: [{ price: priceId, quantity: 1 }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice"],
      metadata: {
        memberId: session.user.id,
        planId,
        ...((planId === "sponsor" || planId === "seller") &&
        businessData &&
        Object.keys(businessData).length > 0
          ? { businessData: JSON.stringify(businessData) }
          : {}),
      },
    };


    const subscription = await stripe.subscriptions.create(subscriptionParams);

    const latestInvoice = subscription.latest_invoice as Stripe.Invoice | null;
    if (!latestInvoice) {
      return NextResponse.json(
        { error: "No invoice created for subscription" },
        { status: 500 }
      );
    }

    const paymentIntent =
      typeof latestInvoice.payment_intent === "object"
        ? latestInvoice.payment_intent
        : latestInvoice.payment_intent
          ? await stripe.paymentIntents.retrieve(latestInvoice.payment_intent)
          : null;

    if (!paymentIntent?.client_secret) {
      const amountDue = typeof latestInvoice.amount_due === "number" ? latestInvoice.amount_due : 0;
      if (subscription.status === "trialing" && amountDue === 0) {
        const subId = typeof subscription === "object" ? subscription.id : subscription;
        await prisma.subscription.create({
          data: {
            memberId: session.user.id,
            plan: planId as "subscribe" | "sponsor" | "seller",
            stripeSubscriptionId: subId,
            stripeCustomerId: customerId,
            status: "active",
          },
        });
        if (
          (planId === "sponsor" || planId === "seller") &&
          businessData &&
          typeof businessData === "object"
        ) {
          try {
            await createBusinessFromDraft(session.user.id, businessData);
          } catch (bErr) {
            console.error("[mobile-subscription-setup] business create:", bErr);
          }
        }
        return NextResponse.json({
          completed: true,
          subscriptionId: subscription.id,
        });
      }
      await stripe.subscriptions.cancel(subscription.id);
      return NextResponse.json(
        { error: "Subscription requires payment but no payment intent was created" },
        { status: 500 }
      );
    }

    const ephemeralKey = await stripe.ephemeralKeys.create({
      customer: customerId,
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customerId,
      subscriptionId: subscription.id,
    });
  } catch (e) {
    const err = e as Error;
    console.error("[mobile-subscription-setup]", err);
    return NextResponse.json(
      { error: err.message ?? "Setup failed" },
      { status: 500 }
    );
  }
}
