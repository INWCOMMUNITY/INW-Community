"use client";

import { useState } from "react";
import { CheckoutButton } from "@/components/CheckoutButton";

export function BillingIntervalCheckout({
  planId,
  children,
  className = "btn",
}: {
  planId: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");

  return (
    <div className="flex flex-col items-center gap-4">
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
          Yearly
        </button>
      </div>
      <CheckoutButton planId={planId} interval={interval} className={className}>
        {children}
      </CheckoutButton>
    </div>
  );
}
