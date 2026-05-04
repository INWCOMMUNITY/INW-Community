import type { Plan } from "database";
import { collectSubscribeStripePriceIds } from "@/lib/stripe-subscription-plan-env";

/** Resolve NWC plan from Stripe Price id (env). Used when subscription metadata is missing. */
export function planFromStripePriceId(priceId: string | undefined | null): Plan | null {
  if (!priceId?.trim()) return null;
  const id = priceId.trim();
  for (const subId of collectSubscribeStripePriceIds()) {
    if (subId === id) return "subscribe";
  }
  const pairs: [string | undefined, Plan][] = [
    [process.env.STRIPE_PRICE_SUBSCRIBE_YEARLY, "subscribe"],
    [process.env.STRIPE_PRICE_SPONSOR, "sponsor"],
    [process.env.STRIPE_PRICE_BUSINESS_SUMMER_STARTUP_YEARLY, "sponsor"],
    [process.env.STRIPE_PRICE_SPONSOR_SUMMER_STARTUP_YEARLY, "sponsor"],
    [process.env.STRIPE_PRICE_SPONSOR_YEARLY, "sponsor"],
    [process.env.STRIPE_PRICE_SELLER, "seller"],
    [process.env.STRIPE_PRICE_SELLER_SUMMER_STARTUP_YEARLY, "seller"],
    [process.env.STRIPE_PRICE_SELLER_YEARLY, "seller"],
  ];
  for (const [envId, plan] of pairs) {
    if (envId && envId === id) return plan;
  }
  return null;
}
