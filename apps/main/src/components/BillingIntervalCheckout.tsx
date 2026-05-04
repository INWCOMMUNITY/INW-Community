"use client";

import { useState } from "react";
import { CheckoutButton } from "@/components/CheckoutButton";
import { ResidentSubscribeTierPicker } from "@/components/ResidentSubscribeTierPicker";
import {
  defaultYearlyToggleLabel,
  formatSubscriptionPriceForInterval,
  planHasYearlyBilling,
} from "@/lib/subscription-plan-prices";

export function BillingIntervalCheckout({
  planId,
  children,
  className = "btn",
  yearlyButtonLabel,
}: {
  planId: string;
  children: React.ReactNode;
  className?: string;
  /** Shown on the non-monthly option; defaults to Summer wording for Business/Seller. */
  yearlyButtonLabel?: string;
}) {
  const hasYearly = planHasYearlyBilling(planId);
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  const yearlyToggleLabel = yearlyButtonLabel ?? defaultYearlyToggleLabel(planId);
  const priceLines = formatSubscriptionPriceForInterval(planId, hasYearly ? interval : "monthly");

  return (
    <div className="flex flex-col items-center gap-4">
      {hasYearly ? (
        <div className="flex justify-center gap-3">
          <button
            type="button"
            onClick={() => setInterval("monthly")}
            className={`px-6 py-3 rounded-lg text-base font-medium transition-colors ${
              interval === "monthly"
                ? "bg-[var(--color-primary)] text-white"
                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setInterval("yearly")}
            className={`px-6 py-3 rounded-lg text-base font-medium transition-colors ${
              interval === "yearly"
                ? "bg-[var(--color-primary)] text-white"
                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            {yearlyToggleLabel}
          </button>
        </div>
      ) : null}
      {priceLines ? (
        <div className="text-center px-2">
          <p className="text-lg font-semibold" style={{ color: "var(--color-heading)" }}>
            {priceLines.primary}
          </p>
          {priceLines.secondary ? (
            <p className="text-sm text-gray-600 mt-1">{priceLines.secondary}</p>
          ) : null}
        </div>
      ) : null}
      {planId === "subscribe" ? (
        <ResidentSubscribeTierPicker variant="plain" buttonClassName={className} />
      ) : (
        <CheckoutButton planId={planId} interval={hasYearly ? interval : "monthly"} className={className}>
          {children}
        </CheckoutButton>
      )}
    </div>
  );
}
