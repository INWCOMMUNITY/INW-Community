import Stripe from "stripe";
import {
  collectSellerYearlyStripePriceCandidates,
  collectSponsorYearlyStripePriceCandidates,
} from "@/lib/stripe-subscription-plan-env";

/**
 * For Business/Seller annual checkout: try each configured yearly price id in priority order
 * and use the first one Stripe reports as active + recurring. Skips archived ids so a stale
 * Summer env does not block checkout when legacy (or a later candidate) still points at an active price.
 */
export async function resolveFirstActiveYearlySponsorSellerPrice(
  stripe: Stripe,
  planId: "sponsor" | "seller"
): Promise<
  | { ok: true; priceId: string; price: Stripe.Price }
  | { ok: false; error: string; triedPriceIds: string[] }
> {
  const candidates =
    planId === "sponsor" ? collectSponsorYearlyStripePriceCandidates() : collectSellerYearlyStripePriceCandidates();
  if (candidates.length === 0) {
    return {
      ok: false,
      error:
        planId === "sponsor"
          ? "Annual Business (Summer Startup) is not configured. Set STRIPE_PRICE_BUSINESS_SUMMER_STARTUP_YEARLY to your active $100/year Stripe price id (optional alias: STRIPE_PRICE_SPONSOR_SUMMER_STARTUP_YEARLY)."
          : "Annual Seller (Summer Startup) is not configured. Set STRIPE_PRICE_SELLER_SUMMER_STARTUP_YEARLY to your active $100/year Stripe price id.",
      triedPriceIds: [],
    };
  }

  const triedPriceIds: string[] = [];
  for (const candidate of candidates) {
    triedPriceIds.push(candidate);
    try {
      const price = await stripe.prices.retrieve(candidate);
      if (!price.active) {
        console.warn("[stripe/yearly] skipping inactive (archived) price id", { planId, priceId: candidate });
        continue;
      }
      if (price.type !== "recurring") {
        console.warn("[stripe/yearly] skipping non-recurring price id", { planId, priceId: candidate });
        continue;
      }
      if (candidate !== candidates[0]) {
        console.info("[stripe/yearly] using fallback active yearly price", {
          planId,
          priceId: candidate,
          skippedInactive: candidates.slice(0, candidates.indexOf(candidate)),
        });
      }
      return { ok: true, priceId: candidate, price };
    } catch (e) {
      console.warn("[stripe/yearly] price retrieve failed", { planId, priceId: candidate, err: e });
    }
  }

  const envHint =
    planId === "sponsor"
      ? "Update STRIPE_PRICE_BUSINESS_SUMMER_STARTUP_YEARLY (Summer $100/yr) to an active recurring yearly price id in Stripe Dashboard → Products, or clear stale env values and redeploy."
      : "Update STRIPE_PRICE_SELLER_SUMMER_STARTUP_YEARLY to an active recurring yearly price id in Stripe Dashboard → Products, or clear stale env values and redeploy.";

  return {
    ok: false,
    error: `Yearly billing is unavailable: none of the configured annual Stripe prices are active. ${envHint} (Checked: ${triedPriceIds.join(", ")}.)`,
    triedPriceIds,
  };
}
