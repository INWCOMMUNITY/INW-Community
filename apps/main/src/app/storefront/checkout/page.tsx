"use client";

import { useState, useEffect } from "react";
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

type CheckoutData = {
  clientSecret: string;
  orderIds: string[];
  summary: { items: SummaryItem[]; totalCents: number };
  successUrl: string;
};

function PaymentForm({ successUrl, orderIds }: { successUrl: string; orderIds: string[] }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elementReady, setElementReady] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || !elementReady) return;
    setError(null);
    setLoading(true);
    try {
      const { error: submitError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: successUrl,
        },
      });
      if (submitError) {
        setError(submitError.message ?? "Payment failed");
        setLoading(false);
        return;
      }
      window.sessionStorage.removeItem(CHECKOUT_STORAGE_KEY);
      router.push(successUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        onReady={() => setElementReady(true)}
        options={{
          paymentMethodOrder: ["apple_pay", "google_pay", "link", "card"],
        }}
      />
      {error && (
        <p className="text-sm" style={{ color: "var(--color-primary)" }}>
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!stripe || !elements || !elementReady || loading}
        className="btn w-full disabled:opacity-70 disabled:cursor-not-allowed"
        style={{ opacity: 1 }}
      >
        {loading ? "Processing…" : "Pay"}
      </button>
    </form>
  );
}

export default function CheckoutPage() {
  const router = useRouter();
  const [data, setData] = useState<CheckoutData | null>(null);
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null);

  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(CHECKOUT_STORAGE_KEY) : null;
    if (!raw) {
      router.replace("/cart");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as CheckoutData;
      if (!parsed.clientSecret || !parsed.summary?.items || parsed.orderIds?.length === 0) {
        router.replace("/cart");
        return;
      }
      setData(parsed);
    } catch {
      router.replace("/cart");
    }
  }, [router]);

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) return;
    // Use pure import + setLoadParameters to avoid loading crypto/onramp modules that can throw
    if (typeof loadStripe.setLoadParameters === "function") {
      loadStripe.setLoadParameters({ advancedFraudSignals: false });
    }
    loadStripe(key).then(setStripePromise).catch((err) => {
      console.warn("Stripe failed to load:", err);
    });
  }, []);

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
              style={{ color: "var(--color-accent, #2563eb)" }}
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

  const { summary, orderIds, successUrl } = data;

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
            stripe={stripePromise}
            options={{
              clientSecret: data.clientSecret,
              appearance: {
                theme: "stripe",
                variables: {
                  colorPrimary: "var(--color-primary)",
                },
              },
            }}
          >
            <PaymentForm successUrl={successUrl} orderIds={orderIds} />
          </Elements>
        </div>
      </div>
    </section>
  );
}
