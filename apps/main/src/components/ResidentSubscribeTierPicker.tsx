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
  /** `card` = bordered panel; `plain` = no outer chrome; `stepper` = compact +/− row. */
  variant?: "card" | "plain" | "stepper";
}) {
  const [dollars, setDollars] = useState(10);

  const shell =
    variant === "card"
      ? "w-full space-y-3 rounded-lg border border-gray-200 bg-gray-50/90 p-4"
      : "w-full space-y-3";

  return (
    <div className={shell}>
      <p className="text-sm font-semibold text-gray-900 text-center">Pay what you can</p>
      {variant === "stepper" ? (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            aria-label="Decrease monthly amount"
            disabled={dollars <= 1}
            onClick={() => setDollars((d) => Math.max(1, d - 1))}
            className="h-10 w-10 rounded-full border-2 border-[var(--color-primary)] text-lg font-semibold leading-none disabled:opacity-40"
            style={{ color: "var(--color-primary)" }}
          >
            −
          </button>
          <p className="min-w-[5.5rem] text-center text-lg font-bold text-gray-900">${dollars}/mo</p>
          <button
            type="button"
            aria-label="Increase monthly amount"
            disabled={dollars >= 15}
            onClick={() => setDollars((d) => Math.min(15, d + 1))}
            className="h-10 w-10 rounded-full border-2 border-[var(--color-primary)] text-lg font-semibold leading-none disabled:opacity-40"
            style={{ color: "var(--color-primary)" }}
          >
            +
          </button>
        </div>
      ) : (
        <>
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
        </>
      )}
      <CheckoutButton
        planId="subscribe"
        interval="monthly"
        subscribeTierDollars={dollars}
        className={buttonClassName}
      >
        {`Subscribe · $${dollars}/mo`}
      </CheckoutButton>
    </div>
  );
}
