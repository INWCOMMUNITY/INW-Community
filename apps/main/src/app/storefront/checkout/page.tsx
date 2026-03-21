"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { loadStripe } from "@stripe/stripe-js/pure";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

const CHECKOUT_STORAGE_KEY = "storefront_checkout";

type SummaryItem = {
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

type PaymentItem = {
  clientSecret: string;
  orderIds: string[];
  /** Required for Stripe Connect: PaymentIntent is created on this connected account. */
  stripeAccountId?: string;
};

type CheckoutData = {
  payments: PaymentItem[];
  paymentIndex: number;
  orderIds: string[];
  summary: { items: SummaryItem[]; totalCents: number };
  successUrl: string;
  /** Legacy: single payment */
  clientSecret?: string;
};

function PaymentForm({
  clientSecret,
  successUrl,
  orderIds,
  onSuccess,
  paymentLabel,
}: {
  clientSecret: string;
  successUrl: string;
  orderIds: string[];
  onSuccess: () => void;
  paymentLabel?: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setError(null);
    setLoading(true);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setError(submitError.message ?? "Check your payment details");
        return;
      }
      const { error: confirmError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: successUrl,
        },
      });
      if (confirmError) {
        setError(confirmError.message ?? "Payment failed");
        return;
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {paymentLabel && (
        <p className="text-sm" style={{ color: "var(--color-text)" }}>
          {paymentLabel}
        </p>
      )}
      <PaymentElement
        key={clientSecret}
        options={{
          // Card first: wallet methods first can delay or skip onReady on some browsers, leaving Pay disabled.
          paymentMethodOrder: ["card", "link", "apple_pay", "google_pay"],
        }}
      />
      {error && (
        <p className="text-sm" style={{ color: "var(--color-primary)" }}>
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!stripe || !elements || loading}
        className="btn w-full disabled:opacity-70 disabled:cursor-not-allowed"
      >
        {loading ? "Processing…" : "Pay"}
      </button>
    </form>
  );
}

function normalizeCheckoutData(parsed: CheckoutData & { payments?: PaymentItem[]; paymentIndex?: number }): CheckoutData | null {
  if (!parsed.summary?.items || parsed.orderIds?.length === 0) return null;
  const payments =
    Array.isArray(parsed.payments) && parsed.payments.length > 0
      ? parsed.payments
      : parsed.clientSecret
        ? [{ clientSecret: parsed.clientSecret, orderIds: parsed.orderIds }]
        : null;
  if (!payments?.length) return null;
  const paymentIndex = Math.min(parsed.paymentIndex ?? 0, payments.length - 1);
  return {
    payments,
    paymentIndex,
    orderIds: parsed.orderIds,
    summary: parsed.summary,
    successUrl: parsed.successUrl,
  };
}

export default function CheckoutPage() {
  const router = useRouter();
  const [data, setData] = useState<CheckoutData | null>(null);
  const [paymentIndex, setPaymentIndex] = useState(0);

  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(CHECKOUT_STORAGE_KEY) : null;
    if (!raw) {
      router.replace("/cart");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as CheckoutData & { payments?: PaymentItem[]; paymentIndex?: number };
      const normalized = normalizeCheckoutData(parsed);
      if (!normalized) {
        router.replace("/cart");
        return;
      }
      setData(normalized);
      setPaymentIndex(normalized.paymentIndex);
    } catch {
      router.replace("/cart");
    }
  }, [router]);

  useEffect(() => {
    if (typeof loadStripe.setLoadParameters === "function") {
      loadStripe.setLoadParameters({ advancedFraudSignals: false });
    }
  }, []);

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  const stripePromise = useMemo(() => {
    if (!publishableKey || !data) return null;
    const payment = data.payments[paymentIndex];
    if (!payment?.clientSecret) return null;
    const opts = payment.stripeAccountId?.trim()
      ? { stripeAccount: payment.stripeAccountId.trim() }
      : undefined;
    const promise = loadStripe(publishableKey, opts);
    promise.catch((err) => {
      console.warn("Stripe failed to load:", err);
    });
    return promise;
  }, [publishableKey, data, paymentIndex]);

  if (!data) {
    return (
      <section style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <p style={{ color: "var(--color-text)" }}>Loading checkout…</p>
        </div>
      </section>
    );
  }

  if (!stripePromise) {
    return (
      <section style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center space-y-3">
          <p className="font-medium" style={{ color: "var(--color-heading)" }}>
            Payment form is not configured
          </p>
          <p className="text-sm max-w-md mx-auto" style={{ color: "var(--color-text)" }}>
            Add <code className="bg-black/10 px-1 rounded">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> to your{" "}
            <code className="bg-black/10 px-1 rounded">.env</code> file (in <code className="bg-black/10 px-1 rounded">apps/main</code>) with your Publishable key from Stripe. Get it from{" "}
            <a
              href="https://dashboard.stripe.com/apikeys"
              target="_blank"
              rel="noopener noreferrer"
              className="underline focus:outline-none focus:ring-2 focus:ring-offset-2 rounded"
              style={{ color: "var(--color-primary)" }}
            >
              Dashboard → Developers → API keys
            </a>
            {" "}— use the key that starts with <code className="bg-black/10 px-1 rounded">pk_live_</code> or{" "}
            <code className="bg-black/10 px-1 rounded">pk_test_</code>. Then restart the dev server.
          </p>
        </div>
      </section>
    );
  }

  const { summary, orderIds, successUrl, payments } = data;
  const current = payments[paymentIndex];
  const paymentLabel =
    payments.length > 1 ? `Payment ${paymentIndex + 1} of ${payments.length}` : undefined;

  const handlePaymentSuccess = () => {
    if (paymentIndex < payments.length - 1) {
      const nextIndex = paymentIndex + 1;
      setPaymentIndex(nextIndex);
      try {
        sessionStorage.setItem(
          CHECKOUT_STORAGE_KEY,
          JSON.stringify({
            ...data,
            paymentIndex: nextIndex,
          })
        );
      } catch {
        // continue
      }
    } else {
      window.sessionStorage.removeItem(CHECKOUT_STORAGE_KEY);
      router.push(successUrl);
    }
  };

  return (
    <section style={{ padding: "var(--section-padding)" }} className="overflow-x-hidden">
      <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 md:gap-8">
        {/* Left: logo + itemized list + total */}
        <div className="flex flex-col min-w-0">
          <div className="flex justify-center mb-4 sm:mb-8">
            <Image
              src="/nwc-logo-circle.png"
              alt="Northwest Community"
              width={200}
              height={200}
              className="object-contain w-24 h-24 sm:w-32 sm:h-32 md:w-48 md:h-48"
              priority
            />
          </div>
          <div
            className="rounded-lg border p-4 sm:p-6 flex-1 min-w-0"
            style={{
              borderColor: "var(--color-primary)",
              backgroundColor: "var(--color-background)",
            }}
          >
            <h2
              className="text-base sm:text-lg font-semibold mb-3 sm:mb-4"
              style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
            >
              Order summary
            </h2>
            <ul className="space-y-2 mb-4" style={{ color: "var(--color-text)" }}>
              {summary.items.map((item, idx) => (
                <li key={idx} className="flex justify-between text-sm">
                  <span>
                    {item.name}
                    {item.quantity > 1 && ` × ${item.quantity}`}
                  </span>
                  <span>${(item.lineTotalCents / 100).toFixed(2)}</span>
                </li>
              ))}
            </ul>
            <div
              className="flex justify-between font-bold pt-3 border-t"
              style={{ borderColor: "var(--color-section-alt)", color: "var(--color-heading)" }}
            >
              <span>Total</span>
              <span>${(summary.totalCents / 100).toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Right: Stripe Payment Element */}
        <div
          className="rounded-lg border p-4 sm:p-6 min-w-0"
          style={{
            borderColor: "var(--color-primary)",
            backgroundColor: "var(--color-background)",
          }}
        >
          <h2
            className="text-base sm:text-lg font-semibold mb-3 sm:mb-4"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            Payment
          </h2>
          <Elements
            key={`${current.clientSecret}:${current.stripeAccountId ?? ""}`}
            stripe={stripePromise}
            options={{
              clientSecret: current.clientSecret,
              appearance: {
                theme: "stripe",
                variables: {
                  colorPrimary: "var(--color-primary)",
                  colorTextPlaceholder: "#4b5563",
                },
              },
            }}
          >
            <PaymentForm
              clientSecret={current.clientSecret}
              successUrl={successUrl}
              orderIds={current.orderIds}
              onSuccess={handlePaymentSuccess}
              paymentLabel={paymentLabel}
            />
          </Elements>
        </div>
      </div>
    </section>
  );
}
