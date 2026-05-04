"use client";

import { useState } from "react";
import { CheckoutButton } from "@/components/CheckoutButton";

/**
 * Pay-what-you-can ($1–$15/mo): slider picks the Stripe tier env
 * `STRIPE_PRICE_SUBSCRIBE_TIER_XX` sent as `subscribeTierDollars` to checkout.
 */
export function ResidentSubscribeTierPicker({
  buttonClassName = "btn w-full text-center",
  variant = "card",
}: {
  buttonClassName?: string;
  /** `card` = bordered panel; `plain` = no outer chrome (e.g. inside another CTA). */
  variant?: "card" | "plain";
}) {
  const [dollars, setDollars] = useState(10);

  const shell =
    variant === "card"
      ? "w-full space-y-3 rounded-lg border border-gray-200 bg-gray-50/90 p-4"
      : "w-full space-y-3";

  return (
    <div className={shell}>
      <p className="text-sm font-semibold text-gray-900 text-center">Pay what you can</p>
      <label htmlFor="resident-tier-slider" className="sr-only">
        Choose monthly amount in dollars, 1 through 15
      </label>
      <input
        id="resident-tier-slider"
        type="range"
        min={1}
        max={15}
        step={1}
        value={dollars}
        onChange={(e) => setDollars(Number(e.target.value))}
        className="w-full cursor-pointer accent-[var(--color-primary)]"
      />
      <p className="text-center text-lg font-bold text-gray-900">${dollars}/month</p>
      <CheckoutButton
        planId="subscribe"
        interval="monthly"
        subscribeTierDollars={dollars}
        className={buttonClassName}
      >
        {`Continue to checkout ($${dollars}/mo)`}
      </CheckoutButton>
    </div>
  );
}
