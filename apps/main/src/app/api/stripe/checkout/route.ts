import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { resolveAllowedCheckoutBaseUrl } from "@/lib/checkout-base-url";
import { getStripeCheckoutBranding } from "@/lib/stripe-branding";
import { normalizeSubcategoriesByPrimary } from "@/lib/business-categories";
import { MAX_BUSINESS_GALLERY_PHOTOS } from "@/lib/upload-limits";
import { resolveStripeCustomerIdForMember } from "@/lib/stripe-customer-for-member";
import { NWC_PAID_PLAN_ACCESS_STATUSES, prismaWhereMemberSponsorOrSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import type { EarnedBadge } from "@/lib/badge-award";

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
  data: Record<string, unknown>,
  planId: "subscribe" | "sponsor" | "seller"
): Promise<{ businessId: string; earnedBadges: EarnedBadge[] } | undefined> {
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const city = typeof data.city === "string" ? data.city.trim() : "";
  const categories = Array.isArray(data.categories)
    ? (data.categories as string[]).filter((c) => typeof c === "string" && c.trim()).slice(0, 2)
    : [];
  if (!name || !city || categories.length === 0) return undefined;

  const activeSub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSponsorOrSellerPlanAccess(memberId),
  });
  if (!activeSub) {
    await prisma.business.deleteMany({ where: { memberId } });
  }

  // Business → Seller: reuse Business Hub profile; do not create a second business from checkout form.
  if (planId === "seller") {
    const existingBusiness = await prisma.business.findFirst({
      where: { memberId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (existingBusiness) return { businessId: existingBusiness.id, earnedBadges: [] };
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
      subcategoriesByPrimary: normalizeSubcategoriesByPrimary(categories, data.subcategoriesByPrimary),
      slug,
      photos: Array.isArray(data.photos)
        ? (data.photos as string[]).filter(Boolean).slice(0, MAX_BUSINESS_GALLERY_PHOTOS)
        : [],
      hoursOfOperation: data.hoursOfOperation && typeof data.hoursOfOperation === "object" ? (data.hoursOfOperation as Record<string, string>) : undefined,
    },
  });
  const { awardBusinessSignupBadges } = await import("@/lib/badge-award");
  let earnedBadges: EarnedBadge[] = [];
  try {
    earnedBadges = await awardBusinessSignupBadges(business.id);
  } catch {
    /* best-effort */
  }
  return { businessId: business.id, earnedBadges };
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
    const baseUrl = resolveAllowedCheckoutBaseUrl(body.returnBaseUrl as string | undefined);
    const plans = getPlans();
    const plan = plans[planId];
    const priceId = interval === "yearly" && plan?.priceIdYearly ? plan.priceIdYearly : plan?.priceId;
    if (!priceId) {
      return NextResponse.json(
        { error: interval === "yearly" ? "Yearly plan not configured" : "Invalid plan or Stripe not configured" },
        { status: 400 }
      );
    }

    const planKey = planId as "subscribe" | "sponsor" | "seller";
    const existingSamePlan = await prisma.subscription.findFirst({
      where: {
        memberId: session.user.id,
        plan: planKey,
        status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
      },
    });
    if (existingSamePlan) {
      return NextResponse.json(
        {
          error:
            "You already have an active subscription for this plan. To change billing or cancel, go to Inland Northwest Community → Subscriptions.",
        },
        { status: 400 }
      );
    }

    const metadata: Record<string, string> = {
      memberId: session.user.id,
      planId,
    };
    let checkoutEarnedBadges: EarnedBadge[] = [];
    if (
      (planId === "sponsor" || planId === "seller") &&
      businessData &&
      typeof businessData === "object" &&
      Object.keys(businessData).length > 0
    ) {
      try {
        const draft = await createBusinessDraftInDb(session.user.id, businessData, planKey);
        if (draft) {
          metadata.businessId = draft.businessId;
          checkoutEarnedBadges = draft.earnedBadges;
        }
      } catch (bErr) {
        console.error("[stripe/checkout] business draft create:", bErr);
      }
    }
    const existingStripeCustomerId = await resolveStripeCustomerIdForMember(session.user.id);
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      payment_method_types: ["card", "link"],
      ...(existingStripeCustomerId
        ? { customer: existingStripeCustomerId }
        : { customer_email: session.user.email }),
      client_reference_id: session.user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/my-community?success=1`,
      cancel_url: `${baseUrl}/support-nwc?canceled=1`,
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      metadata,
      // Session metadata alone is not copied onto the Subscription; invoice/webhook fallbacks need this.
      subscription_data: { metadata: { ...metadata } },
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
    return NextResponse.json({ url: checkout.url, earnedBadges: checkoutEarnedBadges });
  } catch (e) {
    console.error("[stripe/checkout]", e);
    const msg =
      e instanceof Error ? e.message : typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : "Checkout failed. Please try again.";
    return NextResponse.json({ error: msg || "Checkout failed. Please try again." }, { status: 500 });
  }
}
