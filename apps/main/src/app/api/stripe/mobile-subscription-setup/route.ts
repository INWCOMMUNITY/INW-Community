import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
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

/**
 * Apple Pay / Payment Sheet on iOS can fail with Stripe yearly prices (interval year, count 1).
 * Express the same cadence as month × 12 for the wallet recurring summary (amount still matches the invoice).
 */
function applePayPresentationIntervals(recurring: Stripe.Price.Recurring | null | undefined): {
  intervalUnit: "month" | "year";
  intervalCount: number;
} {
  const unit = recurring?.interval;
  const count = recurring?.interval_count ?? 1;
  if (unit === "year" && count === 1) {
    return { intervalUnit: "month", intervalCount: 12 };
  }
  if (unit === "year") {
    return { intervalUnit: "year", intervalCount: Math.max(1, count) };
  }
  return { intervalUnit: "month", intervalCount: Math.max(1, count) };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function createBusinessDraftInDb(
  memberId: string,
  data: Record<string, unknown>
): Promise<{ businessId: string; earnedBadges: EarnedBadge[] } | undefined> {
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const city = typeof data.city === "string" ? data.city.trim() : "";
  const shortDescription = typeof data.shortDescription === "string" ? data.shortDescription.trim() : null;
  const fullDescription = typeof data.fullDescription === "string" ? data.fullDescription.trim() : null;
  const categories = Array.isArray(data.categories)
    ? (data.categories as string[]).filter((c) => typeof c === "string" && c.trim()).slice(0, 2)
    : [];

  if (!name || !city) return undefined;
  if (categories.length === 0) return undefined;

  const website = typeof data.website === "string" && data.website.trim()
    ? (data.website.startsWith("http") ? data.website : `https://${data.website}`)
    : null;
  const phone = typeof data.phone === "string" && data.phone.trim() ? data.phone.trim() : null;
  const email = typeof data.email === "string" && data.email.trim() ? data.email.trim() : null;
  const logoUrl = typeof data.logoUrl === "string" && data.logoUrl.trim() ? data.logoUrl.trim() : null;
  const address = typeof data.address === "string" && data.address.trim() ? data.address.trim() : null;
  const photos = Array.isArray(data.photos)
    ? (data.photos as string[]).filter(Boolean).slice(0, MAX_BUSINESS_GALLERY_PHOTOS)
    : [];
  const hoursOfOperation = data.hoursOfOperation && typeof data.hoursOfOperation === "object"
    ? (data.hoursOfOperation as Record<string, string>)
    : undefined;

  const activeSub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSponsorOrSellerPlanAccess(memberId),
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
      shortDescription,
      fullDescription,
      website,
      phone,
      email,
      logoUrl,
      address,
      city,
      categories,
      subcategoriesByPrimary: normalizeSubcategoriesByPrimary(categories, data.subcategoriesByPrimary),
      slug,
      photos,
      hoursOfOperation,
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

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey?.startsWith("sk_") || stripeSecretKey.includes("...")) {
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const planIdRaw = typeof body.planId === "string" ? body.planId.trim().toLowerCase() : "";
    if (planIdRaw !== "subscribe" && planIdRaw !== "sponsor" && planIdRaw !== "seller") {
      return NextResponse.json(
        { error: describeStripeSubscriptionConfigError(planIdRaw || "unknown", "monthly") },
        { status: 400 }
      );
    }
    const planId = planIdRaw;
    const interval = (body.interval as BillingInterval) || "monthly";
    const businessData = body.businessData as Record<string, unknown> | undefined;

    const plans = getStripeSubscriptionPlanPriceIds();
    let priceId = resolveStripeSubscriptionPriceId(plans, planId, interval);
    if (planId === "subscribe" && interval === "monthly") {
      const raw = body.subscribeTierDollars ?? body.subscribeTier;
      if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
        const parsed = typeof raw === "string" ? parseInt(String(raw).trim(), 10) : Number(raw);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 15) {
          return NextResponse.json({ error: "Choose a monthly amount between $1 and $15." }, { status: 400 });
        }
        const tierOrSingle = resolveSubscribeMonthlyPriceForTierSelection(parsed);
        if (!tierOrSingle) {
          return NextResponse.json(
            {
              error: `No Stripe price is configured for $${parsed}/mo. Add STRIPE_PRICE_SUBSCRIBE_TIER_${String(parsed).padStart(2, "0")} or set STRIPE_PRICE_SUBSCRIBE for a single monthly price.`,
            },
            { status: 400 }
          );
        }
        priceId = tierOrSingle;
      }
    }
    const yearlySponsorSeller = interval === "yearly" && (planId === "sponsor" || planId === "seller");
    if (!priceId && !yearlySponsorSeller) {
      return NextResponse.json({ error: describeStripeSubscriptionConfigError(planId, interval) }, { status: 400 });
    }

    const member = await prisma.member.findUnique({
      where: { id: session.user.id },
      select: { email: true, firstName: true, lastName: true, deliveryAddress: true },
    });
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const addr = member.deliveryAddress as { street?: string; city?: string; state?: string; zip?: string } | null;
    const stripeAddress: Stripe.AddressParam | undefined =
      addr?.street || addr?.city || addr?.state || addr?.zip
        ? {
            line1: addr.street ?? "",
            city: addr.city ?? "",
            state: addr.state ?? "",
            postal_code: addr.zip ?? "",
            country: "US",
          }
        : undefined;

    let customerId = await resolveStripeCustomerIdForMember(session.user.id);

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: member.email,
        name: `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() || undefined,
        address: stripeAddress,
      });
      customerId = customer.id;
      await prisma.member.update({
        where: { id: session.user.id },
        data: { stripeCustomerId: customerId },
      });
    } else if (stripeAddress) {
      await stripe.customers.update(customerId, { address: stripeAddress });
    }

    const existingSub = await prisma.subscription.findFirst({
      where: {
        memberId: session.user.id,
        plan: planId as "subscribe" | "sponsor" | "seller",
        status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
      },
    });
    if (existingSub) {
      return NextResponse.json(
        { error: "You already have an active subscription for this plan" },
        { status: 400 }
      );
    }

    let priceDetails: Stripe.Price;
    try {
      if (interval === "yearly" && (planId === "sponsor" || planId === "seller")) {
        const yearly = await resolveFirstActiveYearlySponsorSellerPrice(stripe, planId);
        if (!yearly.ok) {
          return NextResponse.json({ error: yearly.error }, { status: 400 });
        }
        priceId = yearly.priceId;
        priceDetails = yearly.price;
      } else {
        if (!priceId) {
          return NextResponse.json({ error: describeStripeSubscriptionConfigError(planId, interval) }, { status: 400 });
        }
        priceDetails = await stripe.prices.retrieve(priceId);
      }
    } catch (retrieveErr) {
      console.error("[mobile-subscription-setup] price retrieve:", priceId, retrieveErr);
      return NextResponse.json(
        {
          error:
            "Could not load this plan’s Stripe price. Confirm STRIPE_PRICE_* env vars match active (non-archived) price IDs in your Stripe Dashboard.",
        },
        { status: 400 }
      );
    }
    if (interval !== "yearly" || (planId !== "sponsor" && planId !== "seller")) {
      if (!priceDetails.active) {
        return NextResponse.json(
          {
            error:
              interval === "yearly"
                ? "Yearly billing is unavailable: the Stripe price in STRIPE_PRICE_*_YEARLY is archived. Use monthly, or set that env var to an active yearly price (or re-activate the price in Stripe)."
                : "This plan is unavailable: the Stripe price in STRIPE_PRICE_* is archived. Set the env var to an active price or re-activate it in Stripe Dashboard → Products.",
          },
          { status: 400 }
        );
      }
      if (priceDetails.type !== "recurring") {
        return NextResponse.json(
          { error: "The configured Stripe price is not a recurring subscription price." },
          { status: 400 }
        );
      }
    }
    const recurring = priceDetails.recurring;
    const applePayIntervals = applePayPresentationIntervals(recurring ?? null);

    let businessId: string | undefined;
    let stripeSetupEarnedBadges: EarnedBadge[] = [];
    if (
      (planId === "sponsor" || planId === "seller") &&
      businessData &&
      typeof businessData === "object" &&
      Object.keys(businessData).length > 0
    ) {
      try {
        const draft = await createBusinessDraftInDb(session.user.id, businessData);
        if (draft) {
          businessId = draft.businessId;
          stripeSetupEarnedBadges = draft.earnedBadges;
        }
      } catch (bErr) {
        console.error("[mobile-subscription-setup] business draft create:", bErr);
      }
    }

    console.log("[mobile-subscription-setup] Using priceId:", priceId, "for plan:", planId, "interval:", interval);

    const subscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: customerId,
      items: [{ price: priceId, quantity: 1 }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      automatic_tax: { enabled: true },
      expand: ["latest_invoice"],
      metadata: {
        memberId: session.user.id,
        planId,
        ...(businessId ? { businessId } : {}),
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

        let trialEarned = stripeSetupEarnedBadges;
        if (businessId) {
          try {
            const { awardBusinessSignupBadges } = await import("@/lib/badge-award");
            trialEarned = await awardBusinessSignupBadges(businessId);
          } catch {
            /* best-effort */
          }
        }

        return NextResponse.json({
          completed: true,
          subscriptionId: subscription.id,
          earnedBadges: trialEarned,
          applePayPresentation: {
            amountCents: 0,
            currency: "usd",
            intervalUnit: applePayIntervals.intervalUnit,
            intervalCount: applePayIntervals.intervalCount,
            planLabel:
              planId === "subscribe"
                ? "NWC Resident Subscribe"
                : planId === "sponsor"
                  ? "NWC Business"
                  : "NWC Seller",
          },
        });
      }
      await stripe.subscriptions.cancel(subscription.id);
      return NextResponse.json(
        { error: "Subscription requires payment but no payment intent was created" },
        { status: 500 }
      );
    }

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: "2024-11-20.acacia" }
    );

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customerId,
      subscriptionId: subscription.id,
      earnedBadges: stripeSetupEarnedBadges,
      applePayPresentation: {
        amountCents: paymentIntent.amount,
        currency: paymentIntent.currency,
        intervalUnit: applePayIntervals.intervalUnit,
        intervalCount: applePayIntervals.intervalCount,
        planLabel:
          planId === "subscribe"
            ? "NWC Resident Subscribe"
            : planId === "sponsor"
              ? "NWC Business"
              : "NWC Seller",
      },
    });
  } catch (e) {
    const err = e as Error & { statusCode?: number };
    console.error("[mobile-subscription-setup]", e);
    const msg = err.message ?? "";
    if (/inactive/i.test(msg) && /price/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            "The Stripe price for this plan is archived (inactive). Point STRIPE_PRICE_* (or *_YEARLY) at an active price in Stripe Dashboard, or re-activate the price on the product.",
        },
        { status: 400 }
      );
    }
    const status = typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    return NextResponse.json({ error: msg || "Setup failed" }, { status: status === 400 ? 400 : 500 });
  }
}
