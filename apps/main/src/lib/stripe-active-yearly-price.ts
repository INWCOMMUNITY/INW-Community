import Stripe from "stripe";
import {
  collectSellerYearlyStripePriceCandidates,
  collectSponsorYearlyStripePriceCandidates,
} from "@/lib/stripe-subscription-plan-env";

/**
 * For Business/Seller annual checkout: try each configured yearly price id in priority order
 * and use the first one Stripe reports as active + recurring. Skips archived ids so a stale
 * A stale yearly env does not block checkout when a later candidate still points at an active price.
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
          ? "Annual Business is not configured. Yearly checkout is no longer offered."
          : "Annual Seller is not configured. Yearly checkout is no longer offered.",
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
      ? "Clear or update the yearly Business Stripe price env if it is stale, then redeploy."
      : "Clear or update the yearly Seller Stripe price env if it is stale, then redeploy.";

  return {
    ok: false,
    error: `Yearly billing is unavailable: none of the configured annual Stripe prices are active. ${envHint} (Checked: ${triedPriceIds.join(", ")}.)`,
    triedPriceIds,
  };
}
