"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { BusinessForm, type BusinessFormData } from "@/components/BusinessForm";
import { OnboardingProgress } from "@/components/seller-onboarding/OnboardingProgress";
import { ShippingSetupPanel } from "@/components/seller/ShippingSetupPanel";
import { SUBSCRIPTION_PLAN_PRICES } from "@/lib/subscription-plan-prices";

type Step = "account" | "business" | "contact" | "subscribe" | "shipping" | "payouts" | "import";

const STEP_INDEX: Record<Step, number> = {
  account: 1,
  business: 2,
  contact: 3,
  subscribe: 4,
  shipping: 5,
  payouts: 6,
  import: 7,
};

const BUSINESS_STORAGE_KEY = "nwc-seller-onboarding-business";
const SELLER_MONTHLY = SUBSCRIPTION_PLAN_PRICES.seller.monthlyUsd;
const fieldClass =
  "w-full rounded border bg-white px-3 py-2 outline-none focus:border-[var(--color-primary)]";
const cardClass = "space-y-3 rounded-lg border-2 bg-white p-5";
const cardStyle = { borderColor: "var(--color-primary)" };

function isStep(value: string | null): value is Step {
  return value === "account" || value === "business" || value === "contact" || value === "subscribe" || value === "shipping" || value === "payouts" || value === "import";
}

export default function SignupSellerPage() {
  const [step, setStep] = useState<Step>("account");
  const [booting, setBooting] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [businessData, setBusinessData] = useState<BusinessFormData | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showLocalSkip, setShowLocalSkip] = useState(false);
  const [shippingReady, setShippingReady] = useState(false);
  const [stripeReady, setStripeReady] = useState(false);
  const [waitingForPlan, setWaitingForPlan] = useState(false);
  const [etsyConnected, setEtsyConnected] = useState(false);
  const [etsyShopName, setEtsyShopName] = useState<string | null>(null);
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifyShopDomain, setShopifyShopDomain] = useState<string | null>(null);
  const [shopifyShop, setShopifyShop] = useState("");
  const [channelNote, setChannelNote] = useState("");

  const onShippingProgress = useCallback((progress: { shippoConnected: boolean; optionCount: number }) => {
    setShippingReady(progress.shippoConnected && progress.optionCount >= 1);
  }, []);

  function go(next: Step) {
    setError("");
    setStep(next);
    const url = next === "account" ? "/signup/seller" : `/signup/seller?step=${next}`;
    window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("step");
    const justPaid = params.get("success") === "1";
    const host = window.location.hostname;
    setShowLocalSkip(
      process.env.NODE_ENV === "development" && (host === "localhost" || host === "127.0.0.1")
    );

    const notes: string[] = [];
    if (params.get("etsy") === "connected") notes.push("Etsy is connected. You can import listings, or finish without them.");
    if (params.get("shopify") === "connected") notes.push("Shopify is connected. You can import listings, or finish without them.");
    if (params.get("etsy_error")) notes.push("Etsy did not finish connecting. You can try again.");
    if (params.get("shopify_error")) notes.push("Shopify did not finish connecting. You can try again.");
    if (params.get("canceled") === "1") notes.push("Checkout was canceled. You can subscribe when you are ready.");
    if (notes.length) setChannelNote(notes.join(" "));

    try {
      const saved = sessionStorage.getItem(BUSINESS_STORAGE_KEY);
      if (saved) setBusinessData(JSON.parse(saved) as BusinessFormData);
    } catch {
      sessionStorage.removeItem(BUSINESS_STORAGE_KEY);
    }

    async function load(attempt = 0) {
      const qs = isStep(requested) ? `?requested=${encodeURIComponent(requested)}` : "";
      const res = await fetch(`/api/signup/seller/status${qs}`, { credentials: "include" });
      if (!res.ok) {
        if (!cancelled) setBooting(false);
        return;
      }
      const body = (await res.json()) as {
        loggedIn?: boolean;
        step?: string;
        hasSubscription?: boolean;
        stripeConnectStarted?: boolean;
        etsyConnected?: boolean;
        etsyShopName?: string | null;
        shopifyConnected?: boolean;
        shopifyShopDomain?: string | null;
        firstName?: string;
        lastName?: string;
        phone?: string;
      };
      if (cancelled || !body.loggedIn) {
        if (!cancelled) setBooting(false);
        return;
      }
      if (body.firstName) setFirstName(body.firstName);
      if (body.lastName) setLastName(body.lastName);
      if (body.phone) setPhone(body.phone);
      setStripeReady(Boolean(body.stripeConnectStarted));
      setEtsyConnected(Boolean(body.etsyConnected));
      setEtsyShopName(body.etsyShopName ?? null);
      setShopifyConnected(Boolean(body.shopifyConnected));
      setShopifyShopDomain(body.shopifyShopDomain ?? null);

      if (justPaid && !body.hasSubscription && attempt < 8) {
        setWaitingForPlan(true);
        setStep("shipping");
        setBooting(false);
        window.setTimeout(() => void load(attempt + 1), 2000);
        return;
      }
      setWaitingForPlan(false);
      if (isStep(body.step ?? null)) setStep(body.step as Step);
      setBooting(false);
    }

    void load().catch(() => {
      if (!cancelled) setBooting(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function rememberBusiness(data: BusinessFormData) {
    setBusinessData(data);
    sessionStorage.setItem(BUSINESS_STORAGE_KEY, JSON.stringify(data));
  }

  async function handleAccountSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!ageConfirmed) {
      setError("You must confirm you are 16 years or older to sign up.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          signupIntent: "seller",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error?.toLowerCase().includes("already registered")) {
          const signInRes = await signIn("credentials", {
            email: email.trim(),
            password,
            redirect: false,
          });
          if (signInRes?.ok) {
            go("business");
            return;
          }
        }
        setError(data.error ?? "Sign up failed.");
        return;
      }
      if (data.requiresEmailVerification === true) {
        window.location.href = `/login?callbackUrl=${encodeURIComponent("/signup/seller")}&verifyPending=1&plan=seller&email=${encodeURIComponent(email.trim())}`;
        return;
      }
      const signInRes = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
      });
      if (signInRes?.ok) go("business");
      else setError("Account created. Please sign in.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  function handleBusinessDataReady(data: BusinessFormData) {
    rememberBusiness(data);
    go("contact");
  }

  async function handleContactSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const payload: Record<string, unknown> = { phone: phone.trim() || null };
      if (firstName.trim()) payload.firstName = firstName.trim();
      if (lastName.trim()) payload.lastName = lastName.trim();
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "same-origin",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to save.");
        return;
      }
      go("subscribe");
    } catch {
      setError("Failed to save.");
    } finally {
      setLoading(false);
    }
  }

  function checkoutBody() {
    return {
      planId: "seller",
      interval: "monthly",
      businessData: businessData
        ? {
            name: businessData.name,
            shortDescription: businessData.shortDescription,
            fullDescription: businessData.fullDescription,
            website: businessData.website,
            phone: businessData.phone,
            email: businessData.email,
            logoUrl: businessData.logoUrl,
            coverPhotoUrl: businessData.coverPhotoUrl,
            address: businessData.address,
            city: businessData.city,
            categories: businessData.categories,
            subcategoriesByPrimary: businessData.subcategoriesByPrimary,
            photos: businessData.photos,
            hoursOfOperation: businessData.hoursOfOperation,
            facebookUrl: businessData.facebookUrl,
            instagramUrl: businessData.instagramUrl,
            tiktokUrl: businessData.tiktokUrl,
          }
        : {},
    };
  }

  async function handleCheckout() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkoutBody()),
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (res.status === 401) {
        window.location.href = `/login?callbackUrl=${encodeURIComponent("/signup/seller?step=subscribe")}`;
        return;
      }
      setError(data.error ?? "Could not start checkout.");
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function skipCheckoutLocally() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/signup/seller/dev-skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ businessData: checkoutBody().businessData }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not skip checkout.");
        return;
      }
      go("shipping");
    } catch {
      setError("Could not skip checkout.");
    } finally {
      setLoading(false);
    }
  }

  async function startPayouts() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/connect/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ onboardingReturn: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Payment setup failed.");
        return;
      }
      if (data.reused) {
        setStripeReady(true);
        return;
      }
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError("Payment setup did not return a link.");
    } catch {
      setError("Payment setup failed.");
    } finally {
      setLoading(false);
    }
  }

  async function connectEtsy() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/etsy/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ onboarding: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.authorizeUrl) {
        setError(data.error ?? "Could not start the Etsy connection.");
        return;
      }
      window.location.assign(data.authorizeUrl);
    } catch {
      setError("Could not start the Etsy connection.");
    } finally {
      setLoading(false);
    }
  }

  async function connectShopify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/shopify/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ shop: shopifyShop, onboarding: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.authorizeUrl) {
        setError(data.error ?? "Could not start the Shopify connection.");
        return;
      }
      window.location.assign(data.authorizeUrl);
    } catch {
      setError("Could not start the Shopify connection.");
    } finally {
      setLoading(false);
    }
  }

  const wide = step === "business" || step === "shipping";

  if (booting) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center text-sm" style={{ color: "var(--color-text)" }}>
        Loading your signup…
      </div>
    );
  }

  return (
    <div className={`${wide ? "max-w-4xl" : "max-w-xl"} mx-auto px-4 py-12`}>
      {step !== "account" ? <OnboardingProgress stepIndex={STEP_INDEX[step]} /> : null}
      <h1 className={`text-2xl font-bold mb-6 ${step === "subscribe" ? "text-center" : ""}`}>
        Sign up as Seller
      </h1>

      {step === "account" && (
        <form onSubmit={handleAccountSubmit} className="space-y-4">
          <p className="text-gray-600 mb-4">
            Create your account. Next you will add your storefront, shipping, and payouts in order.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Email *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={fieldClass}
              style={{ borderColor: "var(--color-primary)", color: "var(--color-text)" }}
            />
          </div>
          <div className="flex items-start gap-2">
            <input
              id="ageConfirmed"
              type="checkbox"
              checked={ageConfirmed}
              onChange={(e) => setAgeConfirmed(e.target.checked)}
              required
              className="mt-1"
            />
            <label htmlFor="ageConfirmed" className="text-sm">
              I confirm I am 16 years or older (users under 18 need parent/guardian permission).
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password (min 8 characters) *</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className={fieldClass}
              style={{ borderColor: "var(--color-primary)", color: "var(--color-text)" }}
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <p className="text-sm" style={{ color: "var(--color-text)" }}>
            By signing up, you agree to our{" "}
            <Link href="/terms" className="underline hover:no-underline">Terms of Service</Link>
            {" "}and{" "}
            <Link href="/privacy" className="underline hover:no-underline">Privacy Policy</Link>.
          </p>
          <button type="submit" className="btn w-full" disabled={loading}>
            {loading ? "Creating account…" : "Continue"}
          </button>
        </form>
      )}

      {step === "business" && (
        <div className="space-y-4">
          <p className="text-gray-600 mb-4">
            Add the details shoppers see on your storefront. Categories can be your own, not only the directory list.
          </p>
          <BusinessForm mode="signup" onDataReady={handleBusinessDataReady} />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="button" onClick={() => go("account")} className="btn-outline">
            Back
          </button>
        </div>
      )}

      {step === "contact" && (
        <form onSubmit={handleContactSubmit} className="space-y-4">
          <p className="text-gray-600 mb-4">
            Your name and phone, so we can reach you. Shipping details come in the next steps.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">First name</label>
            <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={fieldClass} style={{ borderColor: "var(--color-primary)", color: "var(--color-text)" }} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Last name</label>
            <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className={fieldClass} style={{ borderColor: "var(--color-primary)", color: "var(--color-text)" }} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Phone</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldClass} style={{ borderColor: "var(--color-primary)", color: "var(--color-text)" }} />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => go("business")} className="btn-outline flex-1 text-center">Back</button>
            <button type="submit" className="btn flex-1" disabled={loading}>
              {loading ? "Saving…" : "Continue"}
            </button>
          </div>
        </form>
      )}

      {step === "subscribe" && (
        <div className="space-y-6">
          <div className="flex justify-center mb-4">
            <Image
              src="/nwc-logo-circle-crop.png"
              alt="Northwest Community"
              width={80}
              height={80}
              className="rounded-full object-cover"
            />
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-2" style={{ color: "var(--color-heading)" }}>
            Subscribe to Northwest Community Seller
          </h2>
          <p className="text-lg text-gray-600 mb-6 text-center max-w-lg mx-auto leading-relaxed">
            The Seller subscription includes the Business plan plus access to sell on our online storefront. List items personally and get paid. You can cancel anytime.
          </p>
          <div className="flex flex-col items-center gap-1 mb-2">
            <p className="text-3xl md:text-4xl font-bold text-gray-900 text-center">
              ${SELLER_MONTHLY.toFixed(2)}
              <span className="text-lg font-normal text-gray-600 ml-1">per month</span>
            </p>
          </div>
          <p
            className="mx-auto max-w-lg rounded-lg px-4 py-3 text-center text-sm leading-relaxed"
            style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-earth)" }}
          >
            The monthly fee keeps Northwest Community running. INW does not take a percentage of the items you sell. Card processing fees can still apply on orders, and those show up when you get paid.
          </p>
          {channelNote ? <p className="text-sm text-gray-700 text-center">{channelNote}</p> : null}
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => go("contact")} className="btn-outline flex-1 text-center">Back</button>
            <button type="button" onClick={() => void handleCheckout()} className="btn flex-1 text-center" disabled={loading}>
              {loading ? "Redirecting…" : "Subscribe and complete onboarding"}
            </button>
          </div>
          {showLocalSkip ? (
            <button
              type="button"
              onClick={() => void skipCheckoutLocally()}
              className="mx-auto block text-xs text-gray-500 underline"
              disabled={loading}
            >
              Skip checkout on this computer
            </button>
          ) : null}
        </div>
      )}

      {step === "shipping" && (
        <div className="space-y-6">
          <p className="text-gray-600">
            Connect Shippo, add at least one shipping option, and set combine-shipping or free-shipping rules if you want them.
          </p>
          {waitingForPlan ? (
            <p className="text-sm text-gray-700">Finishing your subscription. Shipping will open in a moment.</p>
          ) : (
            <Suspense fallback={<p className="text-gray-500">Loading shipping…</p>}>
              <ShippingSetupPanel variant="onboarding" onProgress={onShippingProgress} />
            </Suspense>
          )}
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="sticky bottom-4 z-10 rounded-lg border-2 bg-white p-4" style={cardStyle}>
            <p className="mb-3 text-sm" style={{ color: "var(--color-text)" }}>
              {shippingReady
                ? "Shippo is connected and you have a shipping option."
                : "Connect Shippo and add at least one shipping option to continue."}
            </p>
            <button type="button" className="btn w-full text-center" disabled={!shippingReady || waitingForPlan} onClick={() => go("payouts")}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === "payouts" && (
        <div className="space-y-4">
          <p className="text-gray-600">
            Set up Stripe so buyers can pay you. You will leave this page for Stripe, then come back here.
          </p>
          {stripeReady ? (
            <p className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-earth)" }}>
              Stripe payouts are started for this account.
            </p>
          ) : null}
          {channelNote ? <p className="text-sm text-gray-700">{channelNote}</p> : null}
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="button" className="btn" disabled={loading} onClick={() => void startPayouts()}>
            {loading ? "Opening Stripe…" : stripeReady ? "Review payout setup" : "Set up payouts"}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={() => go("shipping")} className="btn-outline flex-1 text-center">Back</button>
            <button type="button" className="btn flex-1 text-center" disabled={!stripeReady} onClick={() => go("import")}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === "import" && (
        <div className="space-y-6">
          <p className="text-gray-600">
            If you already sell on Etsy or Shopify, connect that shop and import your listings. If you only sell on INW, continue to your seller hub.
          </p>
          {channelNote ? <p className="text-sm text-gray-700">{channelNote}</p> : null}
          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className={cardClass} style={cardStyle}>
            <h2 className="font-semibold">Etsy</h2>
            {etsyConnected ? (
              <p className="text-sm text-gray-700">
                Connected{etsyShopName ? `: ${etsyShopName}` : ""}.
              </p>
            ) : (
              <button type="button" className="btn" disabled={loading} onClick={() => void connectEtsy()}>
                Connect Etsy
              </button>
            )}
            {etsyConnected ? (
              <Link href="/seller-hub/apps/etsy/import?onboarding=1" className="btn inline-block">
                Import Etsy listings
              </Link>
            ) : null}
          </div>

          <form onSubmit={connectShopify} className={cardClass} style={cardStyle}>
            <h2 className="font-semibold">Shopify</h2>
            {shopifyConnected ? (
              <p className="text-sm text-gray-700">
                Connected{shopifyShopDomain ? `: ${shopifyShopDomain}` : ""}.
              </p>
            ) : (
              <>
                <label className="block text-sm">
                  Store address
                  <input
                    className={`mt-1 ${fieldClass}`}
                    style={{ borderColor: "var(--color-primary)", color: "var(--color-text)" }}
                    placeholder="your-store.myshopify.com"
                    value={shopifyShop}
                    onChange={(e) => setShopifyShop(e.target.value)}
                    required
                  />
                </label>
                <button type="submit" className="btn" disabled={loading}>
                  Connect Shopify
                </button>
              </>
            )}
            {shopifyConnected ? (
              <Link href="/seller-hub/apps/shopify/import?onboarding=1" className="btn inline-block">
                Import Shopify listings
              </Link>
            ) : null}
          </form>

          <div className="flex gap-2">
            <button type="button" onClick={() => go("payouts")} className="btn-outline flex-1 text-center">Back</button>
            <Link href="/seller-hub" className="btn flex-1 text-center">
              Go to Seller Hub
            </Link>
          </div>
        </div>
      )}

      {step === "account" || step === "subscribe" ? (
        <p className="mt-4 text-center text-sm">
          Already have an account? <Link href="/login" className="underline">Log in</Link>
        </p>
      ) : null}
    </div>
  );
}
