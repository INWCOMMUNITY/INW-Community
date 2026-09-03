import { afterEach, describe, expect, it } from "vitest";
import { planFromStripePriceId, resolveNwcPlanFromStripeSubscription } from "./stripe-price-to-plan";

const ENV_KEYS = [
  "STRIPE_PRICE_SUBSCRIBE",
  "STRIPE_PRICE_SUBSCRIBE_YEARLY",
  "STRIPE_PRICE_SPONSOR",
  "STRIPE_PRICE_SPONSOR_YEARLY",
  "STRIPE_PRICE_SPONSOR_LEGACY",
  "STRIPE_PRICE_BUSINESS_SUMMER_STARTUP_YEARLY",
  "STRIPE_PRICE_SELLER",
  "STRIPE_PRICE_SELLER_YEARLY",
  "STRIPE_PRICE_SELLER_LEGACY",
  "STRIPE_PRICE_SELLER_SUMMER_STARTUP_YEARLY",
] as const;

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
    delete saved[key];
  }
});

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined) {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("planFromStripePriceId", () => {
  it("maps the new Business and Seller monthly and yearly price ids", () => {
    setEnv("STRIPE_PRICE_SPONSOR", "price_biz_mo");
    setEnv("STRIPE_PRICE_SPONSOR_YEARLY", "price_biz_yr");
    setEnv("STRIPE_PRICE_SELLER", "price_sell_mo");
    setEnv("STRIPE_PRICE_SELLER_YEARLY", "price_sell_yr");
    delete process.env.STRIPE_PRICE_BUSINESS_SUMMER_STARTUP_YEARLY;
    delete process.env.STRIPE_PRICE_SELLER_SUMMER_STARTUP_YEARLY;

    expect(planFromStripePriceId("price_biz_mo")).toBe("sponsor");
    expect(planFromStripePriceId("price_biz_yr")).toBe("sponsor");
    expect(planFromStripePriceId("price_sell_mo")).toBe("seller");
    expect(planFromStripePriceId("price_sell_yr")).toBe("seller");
    expect(planFromStripePriceId("price_unknown")).toBeNull();
  });
});

describe("resolveNwcPlanFromStripeSubscription", () => {
  it("uses the live price id over stale metadata", () => {
    setEnv("STRIPE_PRICE_SELLER", "price_sell_mo");
    setEnv("STRIPE_PRICE_SPONSOR", "price_biz_mo");

    expect(
      resolveNwcPlanFromStripeSubscription({
        metadata: { planId: "sponsor" },
        items: { data: [{ price: { id: "price_sell_mo" } }] },
      })
    ).toBe("seller");
  });

  it("falls back to metadata when the price id is not configured", () => {
    setEnv("STRIPE_PRICE_SPONSOR", "price_biz_mo");
    expect(
      resolveNwcPlanFromStripeSubscription({
        metadata: { planId: "sponsor" },
        items: { data: [{ price: { id: "price_not_in_env" } }] },
      })
    ).toBe("sponsor");
  });
});
