"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";

type Step = "account" | "business" | "contact" | "checkout";

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

export default function SignupBusinessPage() {
  const [step, setStep] = useState<Step>("account");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [fullDescription, setFullDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [city, setCity] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAccountSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
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
          signupIntent: "business",
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
        setStep("account");
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
    if (!firstName.trim() || !lastName.trim()) {
      setError("First name and last name are required.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || null,
        }),
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
        body: JSON.stringify({ planId: "sponsor", businessData }),
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (res.status === 401) {
        window.location.href = `/login?callbackUrl=${encodeURIComponent("/signup/business")}`;
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
      <h1 className="text-2xl font-bold mb-6">Sign up as Business</h1>

      {step === "account" && (
        <form onSubmit={handleAccountSubmit} className="space-y-4" noValidate>
          <p className="text-gray-600 mb-4">
            Create your account. You will add business and contact info next.
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
          <button type="submit" className="btn w-full" disabled={loading}>
            {loading ? "Creating account…" : "Continue"}
          </button>
        </form>
      )}

      {step === "business" && (
        <form onSubmit={handleBusinessSubmit} className="space-y-4">
          <p className="text-gray-600 mb-4">
            Add your business details for your storefront.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Company name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Brief description *</label>
            <textarea
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              rows={2}
              required
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Full description *</label>
            <textarea
              value={fullDescription}
              onChange={(e) => setFullDescription(e.target.value)}
              rows={4}
              required
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">City *</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
              className="w-full border rounded px-3 py-2"
            />
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
                      prev.includes(cat)
                        ? prev.filter((c) => c !== cat)
                        : prev.length < 2
                          ? [...prev, cat]
                          : prev
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
            <button type="button" onClick={() => setStep("account")} className="btn flex-1">
              Back
            </button>
            <button type="submit" className="btn flex-1">Continue</button>
          </div>
        </form>
      )}

      {step === "contact" && (
        <form onSubmit={handleContactSubmit} className="space-y-4">
          <p className="text-gray-600 mb-4">
            Private contact details for NWC to reach you.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">First name *</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Last name *</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Phone (optional)</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border rounded px-3 py-2" />
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
          <p className="text-gray-600 mb-4">
            Subscribe as a Business to publish your storefront. You can cancel anytime.
          </p>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("contact")} className="btn flex-1">
              Back
            </button>
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
