import type { Plan } from "database";

/** Resolve NWC plan from Stripe Price id (env). Used when subscription metadata is missing. */
export function planFromStripePriceId(priceId: string | undefined | null): Plan | null {
  if (!priceId?.trim()) return null;
  const id = priceId.trim();
  const pairs: [string | undefined, Plan][] = [
    [process.env.STRIPE_PRICE_SUBSCRIBE, "subscribe"],
    [process.env.STRIPE_PRICE_SUBSCRIBE_YEARLY, "subscribe"],
    [process.env.STRIPE_PRICE_SPONSOR, "sponsor"],
    [process.env.STRIPE_PRICE_SPONSOR_YEARLY, "sponsor"],
    [process.env.STRIPE_PRICE_SELLER, "seller"],
    [process.env.STRIPE_PRICE_SELLER_YEARLY, "seller"],
  ];
  for (const [envId, plan] of pairs) {
    if (envId && envId === id) return plan;
  }
  return null;
}
