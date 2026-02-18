"use client";

import { useState } from "react";
import Link from "next/link";
import { cloudinaryFetchUrl } from "@/lib/cloudinary";
import { WIX_IMG } from "@/lib/wix-media";

const PLANS = [
  {
    id: "subscribe",
    name: "Northwest Community Subscription",
    price: 10,
    interval: "month",
    description:
      "This plan helps support our business and what we do, as well as provides access to our coupons, access to exclusive groups, and gets you exclusive hints in our scavenger hunts!",
    highlight: true,
    imagePath: "2bdd49_7de70ff63f78486392f92fbd40c8c73e~mv2.jpg/v1/fill/w_147,h_95,al_c,q_80,usm_0.66_1.00_0.01,blur_2,enc_avif,quality_auto/2bdd49_7de70ff63f78486392f92fbd40c8c73e~mv2.jpg",
  },
  {
    id: "sponsor",
    name: "Northwest Community Sponsor",
    price: 20,
    interval: "month",
    description:
      "Join Northwest Community's Local Business Directory. Offer coupons, post events on our calendar, and gain visibility through the events NWC will put on.",
    highlight: true,
    imagePath: "2bdd49_e16f54dfbbf44525bf5a7dca343a7e03~mv2.jpg/v1/fill/w_147,h_74,al_c,q_80,usm_0.66_1.00_0.01,blur_2,enc_avif,quality_auto/2bdd49_e16f54dfbbf44525bf5a7dca343a7e03~mv2.jpg",
  },
  {
    id: "seller",
    name: "Northwest Community Seller",
    price: 30,
    interval: "month",
    description:
      "Become a Sponsor as well as gain access to sell on our online storefront as a local business! List items personally and get paid, without NWC taking personal percentages from your sold items.",
    highlight: true,
    imagePath: "2bdd49_85a6f874c20a4f1db5abfb6f3d9b9bdb~mv2.jpg/v1/fill/w_147,h_74,al_c,q_80,usm_0.66_1.00_0.01,blur_2,enc_avif,quality_auto/2bdd49_85a6f874c20a4f1db5abfb6f3d9b9bdb~mv2.jpg",
  },
];

export function Plans() {
  const [loading, setLoading] = useState<string | null>(null);

  async function handleSubscribe(planId: string) {
    setLoading(planId);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, interval: "monthly" }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (res.status === 401) {
        window.location.href = `/login?callbackUrl=${encodeURIComponent(
          typeof window !== "undefined" ? window.location.pathname : "/support-nwc"
        )}`;
        return;
      }
      setLoading(null);
    } catch {
      setLoading(null);
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
      {PLANS.map((plan) => (
        <div
          key={plan.id}
          id={`plan-${plan.id}`}
          className={`border-2 rounded-lg p-6 scroll-mt-24 ${
            plan.highlight ? "border-[var(--color-primary)]" : "border-[var(--color-primary)]"
          }`}
        >
          <p className="text-sm font-medium text-blue-600 mb-2">Best Value</p>
          {"imagePath" in plan && plan.imagePath && (
            <div className="flex justify-center mb-4">
              <img
                src={cloudinaryFetchUrl(WIX_IMG(plan.imagePath))}
                alt=""
                width={147}
                height={plan.id === "subscribe" ? 95 : 74}
                className="object-contain rounded"
              />
            </div>
          )}
          <h2 className="text-xl font-bold mb-2">{plan.name}</h2>
          <p className="text-3xl font-bold mb-2">
            ${plan.price}
            <span className="text-base font-normal text-gray-600"> / {plan.interval}</span>
          </p>
          <p className="text-sm mb-4 opacity-90">{plan.description}</p>
          <p className="text-xs opacity-70 mb-4">Valid until canceled</p>
          <button
            type="button"
            onClick={() => handleSubscribe(plan.id)}
            disabled={!!loading}
            className="btn w-full"
          >
            {loading === plan.id ? "Redirecting…" : "Subscribe"}
          </button>
        </div>
      ))}
    </div>
  );
}
