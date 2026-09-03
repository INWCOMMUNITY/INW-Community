"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { WIX_IMG } from "@/lib/wix-media";
import { CheckoutButton } from "@/components/CheckoutButton";
import { ResidentSubscribeTierPicker } from "@/components/ResidentSubscribeTierPicker";
import { useSiteImageUrls } from "@/components/SiteImageUrls";
import { SUBSCRIPTION_PLAN_PRICES } from "@/lib/subscription-plan-prices";

type SupportPlanId = "subscribe" | "sponsor" | "seller";
type BillingInterval = "monthly" | "yearly";

type SupportPlanRow = {
  id: SupportPlanId;
  shortName: string;
  name: string;
  features: string[];
  imagePath: string;
  benefitsHref: string;
  cardId: string;
};

const PLANS: SupportPlanRow[] = [
  {
    id: "subscribe",
    shortName: "Subscribe",
    name: "Northwest Community Subscription",
    features: [
      "Member coupon book",
      "Exclusive community groups",
      "Scavenger hunt hints",
      "Community events",
    ],
    imagePath:
      "2bdd49_7de70ff63f78486392f92fbd40c8c73e~mv2.jpg/v1/fill/w_400,h_300,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/2bdd49_7de70ff63f78486392f92fbd40c8c73e~mv2.jpg",
    benefitsHref: "/subscribe-nwc",
    cardId: "resident-pwyc",
  },
  {
    id: "sponsor",
    shortName: "Business",
    name: "Northwest Community Business",
    features: [
      "Everything in Subscribe",
      "Local business directory listing",
      "Create coupons for the book",
      "Post events on community calendars",
      "Business Hub",
    ],
    imagePath:
      "2bdd49_e16f54dfbbf44525bf5a7dca343a7e03~mv2.jpg/v1/fill/w_400,h_300,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/2bdd49_e16f54dfbbf44525bf5a7dca343a7e03~mv2.jpg",
    benefitsHref: "/sponsor-nwc",
    cardId: "sponsor",
  },
  {
    id: "seller",
    shortName: "Seller",
    name: "Northwest Community Seller",
    features: [
      "Everything in Business",
      "Online storefront with payouts",
      "Shipping and fulfillment tools",
      "NWC does not take a cut of sales",
    ],
    imagePath:
      "2bdd49_85a6f874c20a4f1db5abfb6f3d9b9bdb~mv2.jpg/v1/fill/w_400,h_300,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/2bdd49_85a6f874c20a4f1db5abfb6f3d9b9bdb~mv2.jpg",
    benefitsHref: "/sell-nwc",
    cardId: "seller",
  },
];

function planPriceLabel(planId: SupportPlanId, interval: BillingInterval): { primary: string; note?: string } {
  if (planId === "subscribe") {
    return {
      primary: "$1–$15/mo",
      note: interval === "yearly" ? "Residents bill monthly" : "Pay what you can",
    };
  }
  const prices = SUBSCRIPTION_PLAN_PRICES[planId];
  if (interval === "yearly") {
    return {
      primary: `$${prices.yearlyUsd}/year`,
      note: `About $${(prices.yearlyUsd / 12).toFixed(2)}/mo billed annually`,
    };
  }
  return { primary: `$${prices.monthlyUsd}/month` };
}

export default function SupportNWCInfoPage() {
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const siteImages = useSiteImageUrls();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (billing === "yearly" || billing === "annual") {
      setInterval("yearly");
    }
    const goResident = () => {
      if (window.location.hash === "#resident-pwyc") {
        document.getElementById("resident-pwyc")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    goResident();
    window.addEventListener("hashchange", goResident);
    return () => window.removeEventListener("hashchange", goResident);
  }, []);

  return (
    <>
      <section className="py-12 px-6 md:px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto">
          <div className="text-center mb-8">
            <Image
              src={siteImages["nwc-logo-circle"] ?? "/nwc-logo-circle.png"}
              alt="Northwest Community"
              width={104}
              height={104}
              className="mx-auto mb-4 rounded-full object-cover"
              quality={100}
            />
            <h1 className="text-2xl md:text-4xl font-bold mb-3" style={{ color: "var(--color-heading)" }}>
              Support Northwest Community
              <br />
              Join What We Are Doing
            </h1>
            <p className="text-base md:text-lg opacity-80 max-w-xl mx-auto leading-relaxed">
              Plans for the Inland Northwest—Spokane, Kootenai County, and beyond. Pick monthly or yearly; cancel anytime.
            </p>

            <div
              className="mt-6 inline-flex rounded-full border-2 p-1"
              style={{ borderColor: "var(--color-primary)" }}
              role="tablist"
              aria-label="Billing interval"
            >
              <button
                type="button"
                role="tab"
                aria-selected={interval === "monthly"}
                onClick={() => setInterval("monthly")}
                className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
                  interval === "monthly" ? "text-white" : "text-gray-700 hover:bg-gray-100"
                }`}
                style={interval === "monthly" ? { backgroundColor: "var(--color-primary)" } : undefined}
              >
                Monthly
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={interval === "yearly"}
                onClick={() => setInterval("yearly")}
                className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
                  interval === "yearly" ? "text-white" : "text-gray-700 hover:bg-gray-100"
                }`}
                style={interval === "yearly" ? { backgroundColor: "var(--color-primary)" } : undefined}
              >
                Yearly
              </button>
            </div>
            <p className="mt-3 text-sm text-gray-600">All paid plans include the member coupon book.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10 items-stretch">
            {PLANS.map((plan) => {
              const price = planPriceLabel(plan.id, interval);
              return (
                <div
                  key={plan.id}
                  id={plan.cardId}
                  className="border-2 border-[var(--color-primary)] rounded-xl overflow-hidden flex flex-col bg-white scroll-mt-24"
                >
                  <div className="w-full aspect-[16/9] shrink-0 bg-gray-100">
                    <img
                      src={WIX_IMG(plan.imagePath)}
                      alt=""
                      className="w-full h-full object-cover"
                      sizes="(max-width: 768px) 100vw, 33vw"
                    />
                  </div>
                  <div className="p-5 flex flex-col flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--color-primary)" }}>
                      {plan.shortName}
                    </p>
                    <h2 className="text-lg font-bold mb-2 text-gray-900 leading-snug">{plan.name}</h2>
                    <p className="text-2xl font-bold text-gray-900">{price.primary}</p>
                    {price.note ? <p className="text-sm text-gray-500 mt-0.5 mb-3">{price.note}</p> : <div className="mb-3" />}
                    <ul className="space-y-1.5 text-sm text-gray-800 mb-4 flex-1">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex gap-2">
                          <span aria-hidden style={{ color: "var(--color-primary)" }}>
                            ✓
                          </span>
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-gray-500 mb-3">Valid until canceled</p>
                    {plan.id === "subscribe" ? (
                      <ResidentSubscribeTierPicker
                        variant="stepper"
                        buttonClassName="btn w-full text-center inline-block"
                      />
                    ) : (
                      <CheckoutButton
                        planId={plan.id}
                        interval={interval}
                        className="btn w-full text-center inline-block"
                      >
                        Subscribe
                      </CheckoutButton>
                    )}
                    <Link
                      href={plan.benefitsHref}
                      className="mt-3 text-center text-sm font-medium underline-offset-2 hover:underline"
                      style={{ color: "var(--color-primary)" }}
                    >
                      Learn more
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-sm text-gray-600 max-w-2xl mx-auto text-center mb-6">
            By subscribing, you agree to our{" "}
            <Link href="/terms" className="underline" style={{ color: "var(--color-primary)" }}>
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline" style={{ color: "var(--color-primary)" }}>
              Privacy Policy
            </Link>
            . Subscriptions renew until you cancel. Cancel anytime via{" "}
            <Link href="/my-community/subscriptions" className="underline" style={{ color: "var(--color-primary)" }}>
              Inland Northwest Community → Subscriptions
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="relative w-full min-h-[480px] md:min-h-[560px] flex items-center justify-center overflow-hidden mt-8">
        <img
          src={siteImages["why-nwc-background"] ?? "/why-nwc-background.png"}
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-[55%_50%] md:object-[50%_85%] min-w-full min-h-full"
        />
        <div className="relative z-10 max-w-2xl mx-auto px-6 py-12 text-center">
          <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg p-8 md:p-10">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">Why Northwest Community?</h2>
            <p className="mb-4 opacity-90 text-gray-700">
              We connect local businesses and people in Eastern Washington and North Idaho. Paid memberships help us run
              events, giveaways, and keep this platform free for everyone.
            </p>
            <p className="opacity-90 text-gray-700">
              Questions? Open Subscribe, Business, or Sell above, or reach out. We&apos;re here to help.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
