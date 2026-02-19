"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { signIn } from "next-auth/react";

type Step = "account" | "business" | "contact" | "checkout";
type Interval = "monthly" | "yearly";

const CATEGORY_OPTIONS = [
  "Restaurant",
  "Retail",
  "Services",
  "Health & Wellness",
  "Entertainment",
  "Education",
  "Automotive",
  "Other",
];

export default function SignupSellerPage() {
  const [step, setStep] = useState<Step>("account");
  const [interval, setInterval] = useState<Interval>("monthly");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [name, setName] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [fullDescription, setFullDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [city, setCity] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
            setStep("business");
            return;
          }
        }
        setError(data.error ?? "Sign up failed.");
        return;
      }
      const signInRes = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
      });
      if (signInRes?.ok) {
        setStep("business");
      } else {
        setError("Account created. Please sign in.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  function handleBusinessSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const cats = categories.filter(Boolean);
    if (cats.length === 0) {
      setError("Select at least one category.");
      return;
    }
    if (!name.trim() || !shortDescription.trim() || !fullDescription.trim() || !city.trim()) {
      setError("Please fill in all required fields.");
      return;
    }
    setStep("contact");
  }

  async function handleContactSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const deliveryAddress =
        street.trim() || addrCity.trim() || state.trim() || zip.trim()
          ? {
              street: street.trim() || undefined,
              city: addrCity.trim() || undefined,
              state: state.trim() || undefined,
              zip: zip.trim() || undefined,
            }
          : null;
      const payload: Record<string, unknown> = {
        phone: phone.trim() || null,
        deliveryAddress,
      };
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
      setStep("checkout");
    } catch {
      setError("Failed to save.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckout() {
    setError("");
    setLoading(true);
    try {
      const businessData = {
        name: name.trim(),
        shortDescription: shortDescription.trim(),
        fullDescription: fullDescription.trim(),
        website: website.trim() || null,
        phone: businessPhone.trim() || null,
        email: businessEmail.trim() || null,
        city: city.trim(),
        categories: categories.filter(Boolean).slice(0, 2),
      };
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "seller", interval, businessData }),
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (res.status === 401) {
        window.location.href = `/login?callbackUrl=${encodeURIComponent("/signup/seller")}`;
        return;
      }
      setError(data.error ?? "Could not start checkout.");
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-6">Sign up as Seller</h1>

      {step === "account" && (
        <form onSubmit={handleAccountSubmit} className="space-y-4">
          <p className="text-gray-600 mb-4">
            Create your account to start selling on the Community Storefront.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Email *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border rounded px-3 py-2"
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
              className="w-full border rounded px-3 py-2"
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <p className="text-sm text-gray-600">
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
        <form onSubmit={handleBusinessSubmit} className="space-y-4">
          <p className="text-gray-600 mb-4">
            Add your business details. All contact fields are optional.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Company name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Brief description *</label>
            <textarea value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} rows={2} required className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Full description *</label>
            <textarea value={fullDescription} onChange={(e) => setFullDescription(e.target.value)} rows={4} required className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">City *</label>
            <input type="text" value={city} onChange={(e) => setCity(e.target.value)} required className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Categories * (select 1-2)</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() =>
                    setCategories((prev) =>
                      prev.includes(cat) ? prev.filter((c) => c !== cat) : prev.length < 2 ? [...prev, cat] : prev
                    )
                  }
                  className={`px-3 py-1 rounded text-sm border ${
                    categories.includes(cat) ? "bg-blue-100 border-blue-300" : "bg-white border-gray-300"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Website (optional)</label>
            <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Phone (optional)</label>
            <input type="tel" value={businessPhone} onChange={(e) => setBusinessPhone(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email (optional)</label>
            <input type="email" value={businessEmail} onChange={(e) => setBusinessEmail(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("account")} className="btn flex-1">Back</button>
            <button type="submit" className="btn flex-1">Continue</button>
          </div>
        </form>
      )}

      {step === "contact" && (
        <form onSubmit={handleContactSubmit} className="space-y-4">
          <p className="text-gray-600 mb-4">
            Contact and shipping details. All fields optional.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">First name</label>
            <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Last name</label>
            <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Phone</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Shipping address (optional)</label>
            <input type="text" placeholder="Street" value={street} onChange={(e) => setStreet(e.target.value)} className="w-full border rounded px-3 py-2 mb-2" />
            <div className="flex gap-2">
              <input type="text" placeholder="City" value={addrCity} onChange={(e) => setAddrCity(e.target.value)} className="flex-1 border rounded px-3 py-2" />
              <input type="text" placeholder="State" value={state} onChange={(e) => setState(e.target.value)} className="w-20 border rounded px-3 py-2" />
              <input type="text" placeholder="ZIP" value={zip} onChange={(e) => setZip(e.target.value)} className="w-24 border rounded px-3 py-2" />
            </div>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("business")} className="btn flex-1">Back</button>
            <button type="submit" className="btn flex-1" disabled={loading}>
              {loading ? "Saving…" : "Continue to Checkout"}
            </button>
          </div>
        </form>
      )}

      {step === "checkout" && (
        <div className="space-y-4">
          <div className="flex justify-center mb-4">
            <Image
              src="/nwc-logo-circle-crop.png"
              alt="Northwest Community"
              width={80}
              height={80}
              className="rounded-full object-cover"
            />
          </div>
          <p className="text-gray-600 mb-4">
            Subscribe as a Seller to list items on the Community Storefront. You can cancel anytime.
          </p>
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <span className="text-sm font-medium text-gray-700">Billing:</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setInterval("monthly")}
                className={`px-6 py-3 rounded-lg text-base font-medium transition-colors ${
                  interval === "monthly"
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                Monthly ($40)
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
                Yearly ($400)
              </button>
            </div>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("contact")} className="btn flex-1">Back</button>
            <button type="button" onClick={handleCheckout} className="btn flex-1" disabled={loading}>
              {loading ? "Redirecting…" : "Subscribe & Complete"}
            </button>
          </div>
        </div>
      )}

      <p className="mt-4 text-center text-sm">
        Already have an account? <Link href="/login" className="underline">Log in</Link>
      </p>
    </div>
  );
}
