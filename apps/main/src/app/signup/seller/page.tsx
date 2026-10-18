"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { BusinessForm, type BusinessFormData } from "@/components/BusinessForm";
import { OnboardingProgress } from "@/components/seller-onboarding/OnboardingProgress";
import { ShippingSetupPanel } from "@/components/seller/ShippingSetupPanel";
import { PolicyPreviewField, SellerPolicyQuestions } from "@/components/seller/SellerPolicyQuestions";
import {
  freeShippingPolicyLead,
  handlingTimeBoldLine,
  policyFromStored,
  showsFreeReturns,
  type SellerReturnLabelPolicy,
} from "@/lib/seller-return-label-policy";
import { clampAcceptReturnsDays } from "@/lib/store-return";
import { ListingFormSection } from "@/components/store-item/ListingFormSection";
import { IonIcon } from "@/components/IonIcon";
import { formatSubscriptionPriceForInterval } from "@/lib/subscription-plan-prices";

type Step = "account" | "business" | "contact" | "subscribe" | "shipping" | "policies" | "payouts" | "import";

const STEP_INDEX: Record<Step, number> = {
  account: 1,
  business: 2,
  contact: 3,
  subscribe: 4,
  shipping: 5,
  policies: 6,
  payouts: 7,
  import: 8,
};

const BUSINESS_STORAGE_KEY = "nwc-seller-onboarding-business";
const fieldClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[var(--color-primary)]";
const cardStyle = { borderColor: "var(--color-primary)" };

function isStep(value: string | null): value is Step {
  return value === "account" || value === "business" || value === "contact" || value === "subscribe" || value === "shipping" || value === "policies" || value === "payouts" || value === "import";
}

export default function SignupSellerPage() {
  const [step, setStep] = useState<Step>("account");
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");
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
  const [shippingReady, setShippingReady] = useState(false);
  const [policyName, setPolicyName] = useState("This seller");
  const [policyDraft, setPolicyDraft] = useState<SellerReturnLabelPolicy>(() => policyFromStored({}));
  const [policyTexts, setPolicyTexts] = useState({ shipping: "", returns: "" });
  const [offerFreeShippingOnInw, setOfferFreeShippingOnInw] = useState(false);
  const [acceptReturnsDays, setAcceptReturnsDays] = useState(30);
  const [stripeReady, setStripeReady] = useState(false);
  const [waitingForPlan, setWaitingForPlan] = useState(false);
  const [etsyConnected, setEtsyConnected] = useState(false);
  const [etsyShopName, setEtsyShopName] = useState<string | null>(null);
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifyShopDomain, setShopifyShopDomain] = useState<string | null>(null);
  const [shopifyShop, setShopifyShop] = useState("");
  const [channelNote, setChannelNote] = useState("");

  useEffect(() => {
    if (step !== "policies") return;
    let cancelled = false;
    fetch("/api/me/policies", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data || data.error) return;
        setPolicyName(typeof data.sellerPolicyName === "string" && data.sellerPolicyName.trim() ? data.sellerPolicyName : "This seller");
        setPolicyDraft(policyFromStored(data));
        setPolicyTexts({
          shipping: data.sellerShippingPolicy ?? "",
          returns: data.sellerReturnPolicy ?? "",
        });
        setOfferFreeShippingOnInw(data.offerFreeShippingOnInw === true);
        setAcceptReturnsDays(typeof data.acceptReturnsDays === "number" ? data.acceptReturnsDays : 30);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [step]);

  async function savePoliciesAndContinue() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          handlingTime: policyDraft.handlingTime,
          returnLabelPayer: policyDraft.returnLabelPayer,
          returnLabelPayerByReason: policyDraft.returnLabelPayerByReason,
          sellerShippingPolicy: policyTexts.shipping.trim() || null,
          sellerReturnPolicy: policyTexts.returns.trim() || null,
          acceptReturns: true,
          acceptReturnsDays: clampAcceptReturnsDays(acceptReturnsDays),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save policies.");
        return;
      }
      go("payouts");
    } catch {
      setError("Could not save policies.");
    } finally {
      setLoading(false);
    }
  }

  const onShippingProgress = useCallback(
    (progress: { shippoConnected: boolean; optionCount: number; offerFreeShippingOnInw?: boolean }) => {
      const freeOnInw = Boolean(progress.offerFreeShippingOnInw);
      setOfferFreeShippingOnInw(freeOnInw);
      setShippingReady(progress.shippoConnected && (freeOnInw || progress.optionCount >= 1));
    },
    []
  );

  function go(next: Step) {
    setError("");
    setStep(next);
    sessionStorage.setItem("nwc-seller-onboarding-step", next);
    const url = next === "account" ? "/signup/seller" : `/signup/seller?step=${next}`;
    window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("step");
    const justPaid = params.get("success") === "1";

    const billing = params.get("billing");
    const stored = sessionStorage.getItem("nwc-onboarding-billing");
    const initial = billing === "yearly" || billing === "monthly" ? billing : stored === "yearly" ? "yearly" : "monthly";
    sessionStorage.setItem("nwc-onboarding-billing", initial);
    setBillingInterval(initial);

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
      const qs = new URLSearchParams();
      if (isStep(requested)) qs.set("requested", requested);
      if (params.get("enter") === "seller") qs.set("enter", "seller");
      const queryString = qs.toString();
      const query = queryString ? `?${queryString}` : "";
      const res = await fetch(`/api/signup/seller/status${query}`, { credentials: "include" });
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
      const serverStep = isStep(body.step ?? null) ? (body.step as Step) : null;
      const remembered = sessionStorage.getItem("nwc-seller-onboarding-step");
      const rememberedStep = isStep(remembered) ? remembered : null;
      const chosen =
        serverStep && rememberedStep && STEP_INDEX[rememberedStep] > STEP_INDEX[serverStep]
          ? rememberedStep
          : serverStep ?? rememberedStep;
      if (chosen) setStep(chosen);
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

  function selectBilling(next: "monthly" | "yearly") {
    setBillingInterval(next);
    sessionStorage.setItem("nwc-onboarding-billing", next);
  }

  function checkoutBody() {
    return {
      planId: "seller",
      interval: billingInterval,
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

  if (booting) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center text-sm" style={{ color: "var(--color-text)" }}>
        Loading your signup…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <OnboardingProgress stepIndex={STEP_INDEX[step]} />
      <h1 className={`text-2xl font-bold ${step === "subscribe" ? "text-center" : ""} ${step === "payouts" ? "mb-4" : "mb-6"}`} style={{ color: "var(--color-heading)" }}>
        Sign Up as Seller
      </h1>
      {step === "payouts" ? (
        <div className="mb-4 flex justify-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--color-earth)", color: "#fff" }}
          >
            <IonIcon name="wallet-outline" size={32} />
          </div>
        </div>
      ) : null}
      <div className="w-full rounded-2xl px-4 py-6 sm:px-6" style={{ backgroundColor: "var(--color-tan-light, #f7f3ee)" }}>
      <div className="space-y-5">

      {step === "account" && (
        <form onSubmit={handleAccountSubmit}>
          <ListingFormSection title="Account" description="Create your account. Next you will add your storefront, shipping, and payouts in order.">
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
          </ListingFormSection>
        </form>
      )}

      {step === "business" && (
        <div className="space-y-4">
          <p className="text-gray-600 mb-4">
            Add the details shoppers see on your storefront. Categories can be your own, not only the directory list.
          </p>
          <BusinessForm
            mode="signup"
            categoryCatalog="seller"
            onDataReady={handleBusinessDataReady}
            onBack={() => go("account")}
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="button" onClick={() => go("contact")} className="btn-outline w-full text-center">
            Skip this step
          </button>
        </div>
      )}

      {step === "contact" && (
        <form onSubmit={handleContactSubmit}>
          <ListingFormSection title="Contact" description="Your name and phone, so we can reach you. Shipping details come in the next steps.">
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
            <button type="button" onClick={() => go("subscribe")} className="btn-outline flex-1 text-center">
              Skip
            </button>
          </div>
          </ListingFormSection>
        </form>
      )}

      {step === "subscribe" && (
        <ListingFormSection title="Subscription">
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
            Subscribe as a Northwest Community Seller
          </h2>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={() => selectBilling("monthly")}
              className={`px-6 py-2.5 rounded-lg text-base font-medium ${
                billingInterval === "monthly"
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-white text-gray-700 border border-gray-300"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => selectBilling("yearly")}
              className={`px-6 py-2.5 rounded-lg text-base font-medium ${
                billingInterval === "yearly"
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-white text-gray-700 border border-gray-300"
              }`}
            >
              Yearly
            </button>
          </div>
          <div className="flex flex-col items-center gap-1 mb-2">
            <p className="text-3xl md:text-4xl font-bold text-gray-900 text-center">
              {formatSubscriptionPriceForInterval("seller", billingInterval)?.primary}
            </p>
            {billingInterval === "yearly" ? (
              <p className="text-sm text-gray-600">{formatSubscriptionPriceForInterval("seller", "yearly")?.secondary}</p>
            ) : null}
          </div>
          <div className="mb-6 max-w-lg mx-auto space-y-4 text-center text-base leading-relaxed text-gray-700">
            <p>
              The seller subscription includes everything in the business plan, as well as access to our storefront, third-party syncing with Shopify and/or Etsy, shipping items, and getting paid directly through payouts. INW has a monthly subscription because we do not take a percentage of the items you sell.
            </p>
            <p>
              That means when you sell items with us, you only pay about <strong>4.4% + 30¢ per transaction</strong>. That covers credit card processing, tax processing, and a sales tax reserve. That <strong>averages 7% less than most third-party retailers</strong>.
            </p>
          </div>
          {channelNote ? <p className="text-sm text-gray-700 text-center">{channelNote}</p> : null}
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => go("contact")} className="btn-outline flex-1 text-center">Back</button>
            <button type="button" onClick={() => void handleCheckout()} className="btn flex-1 text-center" disabled={loading}>
              {loading ? "Redirecting…" : "Subscribe & Complete Onboarding"}
            </button>
            <button type="button" onClick={() => go("shipping")} className="btn-outline flex-1 text-center">
              Skip
            </button>
          </div>
        </div>
        </ListingFormSection>
      )}

      {step === "shipping" && (
        <div className="space-y-6">
          <p className="text-gray-600">
            Connect Shippo, then add a shipping option unless you offer free shipping on INW. New listings then ship free, so a package is not required.
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
                ? offerFreeShippingOnInw
                  ? "Shippo is connected. New listings ship free, so a shipping option is not required."
                  : "Shippo is connected and you have a shipping option."
                : offerFreeShippingOnInw
                  ? "Connect Shippo to continue. A shipping option is not required while you offer free shipping on INW."
                  : "Connect Shippo and add at least one shipping option to continue."}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => go("subscribe")} className="btn-outline flex-1 text-center">
                Back
              </button>
              <button type="button" className="btn flex-1 text-center" disabled={!shippingReady || waitingForPlan} onClick={() => go("policies")}>
                Continue
              </button>
              <button type="button" className="btn-outline flex-1 text-center" onClick={() => go("policies")}>
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "policies" && (
        <div className="space-y-6">
          <p className="text-gray-600">
            The bold free shipping line, handling time, and FREE RETURNS show at the top of the policy. Type the rest underneath.
          </p>
          <SellerPolicyQuestions
            policy={policyDraft}
            onChange={setPolicyDraft}
            disabled={loading}
          />
          <PolicyPreviewField
            id="onboarding-shipping-policy"
            label="Shipping Policy"
            leads={[freeShippingPolicyLead(offerFreeShippingOnInw)]}
            lead={handlingTimeBoldLine(policyName, policyDraft.handlingTime)}
            value={policyTexts.shipping}
            onChange={(shipping) => setPolicyTexts((prev) => ({ ...prev, shipping }))}
            placeholder="Anything else buyers should know about shipping."
            disabled={loading}
          />
          <div className="space-y-2">
            <label htmlFor="onboarding-accept-returns-days" className="block text-sm font-medium text-gray-700">
              Accept returns for
            </label>
            <div className="flex items-center gap-2">
              <input
                id="onboarding-accept-returns-days"
                type="number"
                min={1}
                max={365}
                value={acceptReturnsDays}
                disabled={loading}
                onChange={(e) => setAcceptReturnsDays(clampAcceptReturnsDays(Number(e.target.value)))}
                className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 disabled:bg-gray-100 disabled:text-gray-400"
              />
              <span className="text-sm text-gray-700">days after delivery</span>
            </div>
            <p className="text-sm text-gray-600">
              Mention this return window in your refund policy below.
            </p>
          </div>
          <PolicyPreviewField
            id="onboarding-return-policy"
            label="Refund Policy"
            leads={[showsFreeReturns(policyDraft) ? "FREE RETURNS" : null]}
            value={policyTexts.returns}
            onChange={(returns) => setPolicyTexts((prev) => ({ ...prev, returns }))}
            placeholder={`e.g. Refunds and returns within ${acceptReturnsDays} days.`}
            disabled={loading}
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => go("shipping")} className="btn-outline flex-1 text-center">Back</button>
            <button type="button" className="btn flex-1 text-center" disabled={loading || !policyDraft.handlingTime} onClick={() => void savePoliciesAndContinue()}>
              {loading ? "Saving…" : "Continue"}
            </button>
            <button type="button" className="btn-outline flex-1 text-center" onClick={() => go("payouts")}>
              Skip
            </button>
          </div>
        </div>
      )}

      {step === "payouts" && (
        <ListingFormSection title="Payouts" description="Set up Stripe so buyers can pay you. You will leave this page for Stripe, then come back here.">
        <div className="space-y-4">
          {stripeReady ? (
            <p className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-earth)" }}>
              Stripe payouts are started for this account.
            </p>
          ) : null}
          {channelNote ? <p className="text-sm text-gray-700">{channelNote}</p> : null}
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="button"
            className="btn w-full text-center !bg-[var(--color-earth)] !text-white hover:!bg-[#4a3f33] hover:!text-white"
            disabled={loading}
            onClick={() => void startPayouts()}
          >
            {loading ? "Opening Stripe…" : stripeReady ? "Review payout setup" : "Set Up Payouts"}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={() => go("policies")} className="btn-outline flex-1 text-center">Back</button>
            <button type="button" className="btn flex-1 text-center" disabled={!stripeReady} onClick={() => go("import")}>
              Continue
            </button>
            <button type="button" className="btn-outline flex-1 text-center" onClick={() => go("import")}>
              Skip
            </button>
          </div>
        </div>
        </ListingFormSection>
      )}

      {step === "import" && (
        <div className="space-y-6">
          <p className="text-gray-600">
            If you already sell on Etsy or Shopify, connect that shop and import your listings. If you only sell on INW, continue to your seller hub.
          </p>
          {channelNote ? <p className="text-sm text-gray-700">{channelNote}</p> : null}
          {error && <p className="text-red-600 text-sm">{error}</p>}

          <ListingFormSection title="Etsy" description="Connect your shop if you want to bring listings over. You can skip this.">
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
          </ListingFormSection>

          <form onSubmit={connectShopify}>
          <ListingFormSection title="Shopify" description="Connect your shop if you want to bring listings over. You can skip this.">
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
          </ListingFormSection>
          </form>

          <div className="flex gap-2">
            <button type="button" onClick={() => go("payouts")} className="btn-outline flex-1 text-center">Back</button>
            <Link href="/seller-hub" className="btn flex-1 text-center">
              Go to Seller Hub
            </Link>
          </div>
        </div>
      )}

      </div>
      </div>
      <OnboardingProgress stepIndex={STEP_INDEX[step]} className="mt-8" />

      {step === "account" || step === "subscribe" ? (
        <p className="mt-4 text-center text-sm">
          Already have an account? <Link href="/login" className="underline">Log in</Link>
        </p>
      ) : null}
    </div>
  );
}
