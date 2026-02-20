import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getStripeCheckoutBranding } from "@/lib/stripe-branding";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

type BillingInterval = "monthly" | "yearly";

function getPlans(): Record<string, { priceId: string; priceIdYearly?: string }> {
  return {
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
}

function isValidEmail(s: string): boolean {
  return typeof s === "string" && s.includes("@") && s.length > 3;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function createBusinessDraftInDb(
  memberId: string,
  data: Record<string, unknown>
): Promise<string | undefined> {
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const city = typeof data.city === "string" ? data.city.trim() : "";
  const categories = Array.isArray(data.categories)
    ? (data.categories as string[]).filter((c) => typeof c === "string" && c.trim()).slice(0, 2)
    : [];
  if (!name || !city || categories.length === 0) return undefined;

  const activeSub = await prisma.subscription.findFirst({
    where: { memberId, status: "active", plan: { in: ["sponsor", "seller"] } },
  });
  if (!activeSub) {
    await prisma.business.deleteMany({ where: { memberId } });
  }
  const existingCount = await prisma.business.count({ where: { memberId } });
  if (existingCount >= 2) return undefined;

  let slug = slugify(name);
  let suffix = 0;
  while (await prisma.business.findUnique({ where: { slug } })) {
    slug = `${slugify(name)}-${++suffix}`;
  }

  const business = await prisma.business.create({
    data: {
      memberId,
      name,
      shortDescription: typeof data.shortDescription === "string" ? data.shortDescription.trim() || null : null,
      fullDescription: typeof data.fullDescription === "string" ? data.fullDescription.trim() || null : null,
      website: typeof data.website === "string" && data.website.trim() ? (data.website.startsWith("http") ? data.website : `https://${data.website}`) : null,
      phone: typeof data.phone === "string" && data.phone.trim() ? data.phone.trim() : null,
      email: typeof data.email === "string" && data.email.trim() ? data.email.trim() : null,
      logoUrl: typeof data.logoUrl === "string" && data.logoUrl.trim() ? data.logoUrl.trim() : null,
      address: typeof data.address === "string" && data.address.trim() ? data.address.trim() : null,
      city,
      categories,
      slug,
      photos: Array.isArray(data.photos) ? (data.photos as string[]).filter(Boolean) : [],
      hoursOfOperation: data.hoursOfOperation && typeof data.hoursOfOperation === "object" ? (data.hoursOfOperation as Record<string, string>) : undefined,
    },
  });
  const { awardBusinessSignupBadges } = await import("@/lib/badge-award");
  awardBusinessSignupBadges(business.id).catch(() => {});
  return business.id;
}

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidEmail(session.user.email)) {
    return NextResponse.json(
      {
        error:
          "Your account needs a valid email address to checkout. Please sign in with an account that has a real email, or update your profile email.",
      },
      { status: 400 }
    );
  }
  try {
    const body = await req.json();
    const planId = body.planId as string;
    const interval = (body.interval as BillingInterval) || "monthly";
    const businessData = body.businessData as Record<string, unknown> | undefined;
    // Mobile can pass returnBaseUrl so redirect works on device (e.g. http://192.168.1.140:3000)
    const returnBase = (body.returnBaseUrl as string)?.trim?.();
    const baseUrl = returnBase || (process.env.NEXTAUTH_URL ?? "");
    const plans = getPlans();
    const plan = plans[planId];
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
      try {
        const businessId = await createBusinessDraftInDb(session.user.id, businessData);
        if (businessId) metadata.businessId = businessId;
      } catch (bErr) {
        console.error("[stripe/checkout] business draft create:", bErr);
      }
    }
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      customer_email: session.user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/my-community?success=1`,
      cancel_url: `${baseUrl}/support-nwc?canceled=1`,
      automatic_tax: { enabled: true },
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
    const msg =
      e instanceof Error ? e.message : typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : "Checkout failed. Please try again.";
    return NextResponse.json({ error: msg || "Checkout failed. Please try again." }, { status: 500 });
  }
}
