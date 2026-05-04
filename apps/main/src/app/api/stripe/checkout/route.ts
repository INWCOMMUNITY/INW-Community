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
import {
  describeStripeSubscriptionConfigError,
  getStripeSubscriptionPlanPriceIds,
  resolveStripeSubscriptionPriceId,
  resolveSubscribeMonthlyPriceForTierSelection,
} from "@/lib/stripe-subscription-plan-env";
import { resolveFirstActiveYearlySponsorSellerPrice } from "@/lib/stripe-active-yearly-price";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

type BillingInterval = "monthly" | "yearly";

function jsonCheckout400(error: string, logLabel: string, fields?: Record<string, unknown>) {
  console.warn(`[stripe/checkout] 400 ${logLabel}`, { ...fields, responseErrorPreview: error.slice(0, 400) });
  return NextResponse.json({ error, code: logLabel }, { status: 400 });
}

function stripeThrownMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** Hosted Checkout: optional Tax; retry without tax when Stripe rejects automatic_tax (common if Tax isn’t fully set up). */
async function createSubscriptionCheckoutSession(
  stripe: Stripe,
  params: Stripe.Checkout.SessionCreateParams,
  branding: ReturnType<typeof getStripeCheckoutBranding>
): Promise<Stripe.Checkout.Session> {
  const applyBranding = (p: Stripe.Checkout.SessionCreateParams) =>
    ({ ...p, ...(branding ? { branding_settings: branding } : {}) } as Stripe.Checkout.SessionCreateParams);

  const taxExplicitlyOff =
    process.env.STRIPE_CHECKOUT_AUTOMATIC_TAX === "false" || process.env.STRIPE_CHECKOUT_AUTOMATIC_TAX === "0";
  const baseParams: Stripe.Checkout.SessionCreateParams = taxExplicitlyOff
    ? { ...params, automatic_tax: { enabled: false } }
    : params;

  try {
    return await stripe.checkout.sessions.create(applyBranding(baseParams));
  } catch (e) {
    const msg = stripeThrownMessage(e);
    if (!taxExplicitlyOff && baseParams.automatic_tax?.enabled === true && /tax/i.test(msg)) {
      console.warn("[stripe/checkout] sessions.create failed (tax); retrying without automatic_tax:", msg.slice(0, 500));
      const noTax = { ...baseParams, automatic_tax: { enabled: false } };
      return await stripe.checkout.sessions.create(applyBranding(noTax));
    }
    throw e;
  }
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
  /** Badges are awarded after payment succeeds (see Stripe webhook), not while checkout is in progress. */
  return { businessId: business.id, earnedBadges: [] };
}

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidEmail(session.user.email)) {
    return jsonCheckout400(
      "Your account needs a valid email address to checkout. Please sign in with an account that has a real email, or update your profile email.",
      "invalid_profile_email",
      { memberId: session.user.id }
    );
  }
  try {
    const body = await req.json();
    const planIdRaw = typeof body.planId === "string" ? body.planId.trim().toLowerCase() : "";
    if (planIdRaw !== "subscribe" && planIdRaw !== "sponsor" && planIdRaw !== "seller") {
      return jsonCheckout400(
        describeStripeSubscriptionConfigError(planIdRaw || "unknown", "monthly"),
        "invalid_plan_id",
        { planIdRaw }
      );
    }
    const planId = planIdRaw;
    const interval = (body.interval as BillingInterval) || "monthly";
    const businessData = body.businessData as Record<string, unknown> | undefined;
    const baseUrl = resolveAllowedCheckoutBaseUrl(body.returnBaseUrl as string | undefined);
    const plans = getStripeSubscriptionPlanPriceIds();
    let priceId = resolveStripeSubscriptionPriceId(plans, planId, interval);
    if (planId === "subscribe" && interval === "monthly") {
      const raw = body.subscribeTierDollars ?? body.subscribeTier;
      if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
        const parsed = typeof raw === "string" ? parseInt(String(raw).trim(), 10) : Number(raw);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 15) {
          return jsonCheckout400(
            "Choose a monthly amount between $1 and $15.",
            "subscribe_tier_invalid_range",
            { raw }
          );
        }
        const tierOrSingle = resolveSubscribeMonthlyPriceForTierSelection(parsed);
        if (!tierOrSingle) {
          return jsonCheckout400(
            `No Stripe price is configured for $${parsed}/mo. Add STRIPE_PRICE_SUBSCRIBE_TIER_${String(parsed).padStart(2, "0")} (or TIER_${parsed} for amounts 1–9), or set STRIPE_PRICE_SUBSCRIBE for a single monthly price.`,
            "subscribe_tier_env_missing",
            { dollars: parsed }
          );
        }
        priceId = tierOrSingle;
      }
    }
    const yearlySponsorSeller = interval === "yearly" && (planId === "sponsor" || planId === "seller");
    // Yearly Business/Seller prices come only from Summer (± optional legacy) envs resolved in Stripe next step.
    if (!priceId && !yearlySponsorSeller) {
      return jsonCheckout400(
        describeStripeSubscriptionConfigError(planId, interval),
        "stripe_price_not_configured",
        { planId, interval }
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
      return jsonCheckout400(
        "You already have an active subscription for this plan. To change billing or cancel, go to Inland Northwest Community → Subscriptions.",
        "already_subscribed_same_plan",
        { planId, memberId: session.user.id, subscriptionId: existingSamePlan.id }
      );
    }

    let priceDetails: Stripe.Price;
    try {
      if (interval === "yearly" && (planId === "sponsor" || planId === "seller")) {
        const yearly = await resolveFirstActiveYearlySponsorSellerPrice(stripe, planId);
        if (!yearly.ok) {
          return jsonCheckout400(yearly.error, "stripe_yearly_no_active_price", {
            planId,
            triedPriceIds: yearly.triedPriceIds,
          });
        }
        priceId = yearly.priceId;
        priceDetails = yearly.price;
      } else {
        if (!priceId) {
          return jsonCheckout400(
            describeStripeSubscriptionConfigError(planId, interval),
            "stripe_price_not_configured",
            { planId, interval }
          );
        }
        priceDetails = await stripe.prices.retrieve(priceId);
        if (!priceDetails.active) {
          return jsonCheckout400(
            interval === "yearly" && planId === "subscribe"
              ? `Yearly billing is unavailable: this Stripe price is archived (inactive). Set STRIPE_PRICE_SUBSCRIBE_YEARLY to an active recurring yearly price in Stripe, or use monthly billing. Price id: ${priceId}.`
              : `This plan is unavailable: the Stripe price is archived (inactive). Update the matching STRIPE_PRICE_* env var or re-activate the price in Stripe Dashboard → Products. Price id: ${priceId}.`,
            "stripe_price_inactive",
            { planId, interval, priceId }
          );
        }
        if (priceDetails.type !== "recurring") {
          return jsonCheckout400(
            "The configured Stripe price is not a recurring subscription price.",
            "stripe_price_not_recurring",
            { planId, interval, priceId }
          );
        }
      }
    } catch (retrieveErr) {
      console.error("[stripe/checkout] price retrieve:", priceId, retrieveErr);
      return jsonCheckout400(
        "Could not load this plan’s Stripe price. Confirm STRIPE_PRICE_* env vars match active price IDs in Stripe Dashboard.",
        "stripe_price_retrieve_failed",
        { planId, interval, priceId }
      );
    }

    console.info("[stripe/checkout]", { planId, interval, priceId });

    const metadata: Record<string, string> = {
      memberId: session.user.id,
      planId,
      stripePriceId: priceId,
      billingInterval: interval,
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
      automatic_tax: {
        enabled:
          process.env.STRIPE_CHECKOUT_AUTOMATIC_TAX !== "false" &&
          process.env.STRIPE_CHECKOUT_AUTOMATIC_TAX !== "0",
      },
      billing_address_collection: "required",
      metadata,
      // Session metadata alone is not copied onto the Subscription; invoice/webhook fallbacks need this.
      subscription_data: { metadata: { ...metadata } },
    };
    const branding = getStripeCheckoutBranding();
    const checkout = await createSubscriptionCheckoutSession(stripe, params, branding);
    if (!checkout.url) {
      console.error("[stripe/checkout] No URL in checkout session:", checkout.id);
      return NextResponse.json({ error: "Checkout could not be created" }, { status: 500 });
    }
    return NextResponse.json({ url: checkout.url, earnedBadges: checkoutEarnedBadges });
  } catch (e) {
    console.error("[stripe/checkout]", e);
    const msg =
      e instanceof Error ? e.message : typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : "Checkout failed. Please try again.";
    const m = msg || "";
    if (/inactive/i.test(m) && /price/i.test(m)) {
      return jsonCheckout400(
        "The Stripe price for this plan is archived (inactive). Point STRIPE_PRICE_* (or *_YEARLY) at an active price in Stripe Dashboard, or re-activate the price on the product.",
        "stripe_checkout_inactive_price",
        { message: m.slice(0, 200) }
      );
    }
    const errObj = typeof e === "object" && e !== null ? (e as { statusCode?: number; type?: string }) : {};
    const rawStatus = typeof errObj.statusCode === "number" ? errObj.statusCode : undefined;
    const stripeType = errObj.type ?? "";
    const isStripeInvalidRequest = /StripeInvalidRequestError/i.test(stripeType);
    if (rawStatus === 400 || isStripeInvalidRequest) {
      console.warn("[stripe/checkout] stripe client error (returning 400 to client)", {
        message: m.slice(0, 500),
        type: stripeType,
        statusCode: rawStatus,
      });
      return NextResponse.json(
        {
          error:
            m ||
            "Checkout was rejected by Stripe. If this mentions tax, set STRIPE_CHECKOUT_AUTOMATIC_TAX=false on the server or finish Stripe Tax setup.",
          code: "stripe_checkout_session_failed",
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: m || "Checkout failed. Please try again.", code: "stripe_checkout_server_error" },
      { status: 500 }
    );
  }
}
