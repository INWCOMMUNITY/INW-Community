"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";

interface Step {
  id: string;
  label: string;
  description: string;
  href?: string;
  completed: boolean;
  onAction?: () => void;
  actionLoading?: boolean;
}

export default function ResaleHubBeforeYouStartPage() {
  const [loading, setLoading] = useState(true);
  const [hasStripeConnect, setHasStripeConnect] = useState(false);
  const [hasShippo, setHasShippo] = useState(false);
  const [hasPolicies, setHasPolicies] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fundsRes, shippingRes, meRes] = await Promise.all([
        fetch("/api/seller-funds"),
        fetch("/api/shipping/status"),
        fetch("/api/me"),
      ]);
      const [funds, shipping, me] = await Promise.all([
        fundsRes.json().catch(() => ({})),
        shippingRes.json().catch(() => ({})),
        meRes.json().catch(() => ({})),
      ]);
      setHasStripeConnect(Boolean(funds?.hasStripeConnect));
      setHasShippo(Boolean(shipping?.connected));
      const policyFields = [
        me?.sellerShippingPolicy,
        me?.sellerLocalDeliveryPolicy,
        me?.sellerPickupPolicy,
        me?.sellerReturnPolicy,
      ];
      setHasPolicies(policyFields.some((v) => typeof v === "string" && v.trim().length > 0));
    } catch {
      setHasStripeConnect(false);
      setHasShippo(false);
      setHasPolicies(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleStripeSetup = async () => {
    setStripeLoading(true);
    try {
      const res = await fetch("/api/stripe/connect/onboard", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (d?.url) window.location.href = d.url;
    } finally {
      setStripeLoading(false);
    }
  };

  const steps: Step[] = [
    {
      id: "stripe",
      label: "Set up Stripe payments",
      description: "Connect your bank account to receive payouts from sales",
      completed: hasStripeConnect,
      onAction: handleStripeSetup,
      actionLoading: stripeLoading,
    },
    {
      id: "shippo",
      label: "Set up Shippo for shipping",
      description: "Connect Shippo to buy shipping labels for orders",
      completed: hasShippo,
      href: "/seller-hub/shipping-setup",
    },
    {
      id: "policies",
      label: "Set your policies",
      description: "Shipping, delivery, pickup, and refund policies for your resale listings",
      completed: hasPolicies,
      href: "/resale-hub/policies",
    },
  ];

  const allComplete = hasStripeConnect && hasShippo && hasPolicies;
  const title = allComplete ? "Checklist" : "Before You Start";
  const subtitle = allComplete
    ? "You're all set. You can still open the links below to update or view."
    : "Complete these steps to start selling in Resale Hub. Set up payments, shipping, and your policies.";

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">{title}</h1>
      <p className="text-gray-600 mb-6">
        {subtitle}
      </p>

      <ul className="space-y-4">
        {steps.map((step) => (
          <li
            key={step.id}
            className={`flex items-center justify-between gap-4 rounded-xl border-2 p-4 ${
              step.completed
                ? "bg-green-50 border-green-600"
                : "bg-gray-50 border-[var(--color-primary)]"
            }`}
          >
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${
                  step.completed
                    ? "border-green-600 bg-green-600 text-white"
                    : "border-[var(--color-primary)]"
                }`}
              >
                {step.completed ? (
                  <IonIcon name="checkmark" size={18} className="text-white" />
                ) : null}
              </span>
              <div className="min-w-0">
                <p
                  className={`font-semibold ${
                    step.completed ? "text-green-800 line-through" : ""
                  }`}
                >
                  {step.label}
                </p>
                <p className="text-sm text-gray-600 mt-0.5">{step.description}</p>
              </div>
            </div>
            {step.href && (
              <Link
                href={step.href}
                className="shrink-0 rounded-lg px-4 py-2 font-medium text-[var(--color-primary)] hover:bg-[var(--color-section-alt)] border-2 border-[var(--color-primary)]"
              >
                {step.completed ? "View" : "Set up"}
              </Link>
            )}
            {step.onAction && !step.completed && (
              <button
                type="button"
                onClick={step.onAction}
                disabled={step.actionLoading}
                className="shrink-0 rounded-lg px-4 py-2 font-medium text-white bg-[var(--color-primary)] hover:opacity-90 disabled:opacity-70"
              >
                {step.actionLoading ? "Starting…" : "Set up"}
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-8 pt-6 border-t border-gray-200">
        <Link href="/resale-hub" className="text-[var(--color-link)] hover:underline font-medium">
          ← Back to Resale Hub
        </Link>
      </div>
    </div>
  );
}
