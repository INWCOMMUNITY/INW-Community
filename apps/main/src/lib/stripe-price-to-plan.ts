import type { Plan } from "database";
import {
  collectSellerStripePriceIds,
  collectSponsorStripePriceIds,
  collectSubscribeStripePriceIds,
} from "@/lib/stripe-subscription-plan-env";

function planFromSubscriptionMetadata(raw: string | undefined | null): Plan | null {
  const meta = raw?.trim();
  if (meta === "subscribe" || meta === "sponsor" || meta === "seller") return meta;
  return null;
}

/** Resolve NWC plan from Stripe Price id (env). Used when subscription metadata is missing. */
export function planFromStripePriceId(priceId: string | undefined | null): Plan | null {
  if (!priceId?.trim()) return null;
  const id = priceId.trim();
  for (const subId of collectSubscribeStripePriceIds()) {
    if (subId === id) return "subscribe";
  }
  if (id === process.env.STRIPE_PRICE_SUBSCRIBE_YEARLY?.trim()) return "subscribe";
  if (collectSponsorStripePriceIds().includes(id)) return "sponsor";
  if (collectSellerStripePriceIds().includes(id)) return "seller";
  return null;
}

type StripeSubPlanSource = {
  metadata?: { planId?: string } | null;
  items?: { data?: Array<{ price?: string | { id?: string } | null }> };
};

/**
 * Live Stripe price is the source of truth after a Dashboard price change.
 * Metadata `planId` is only a fallback when the price id is not in env yet.
 */
export function resolveNwcPlanFromStripeSubscription(sub: StripeSubPlanSource): Plan | null {
  const rawPrice = sub.items?.data?.[0]?.price;
  const priceId = typeof rawPrice === "string" ? rawPrice : rawPrice?.id ?? null;
  return planFromStripePriceId(priceId) ?? planFromSubscriptionMetadata(sub.metadata?.planId);
}
