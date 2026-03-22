import type Stripe from "stripe";

/**
 * Map Stripe subscription.status → our Subscription.status.
 * Returns null when we should NOT overwrite DB status (e.g. `incomplete` during checkout),
 * so checkout.session.completed can leave the row `active` instead of being clobbered.
 */
export function stripeSubscriptionStatusToDb(
  status: Stripe.Subscription.Status
): "active" | "past_due" | "canceled" | null {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due") return "past_due";
  if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") return "canceled";
  return null;
}
