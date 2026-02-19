"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { BusinessForm, type BusinessFormData } from "@/components/BusinessForm";

type Step = "account" | "business" | "contact" | "checkout";

export default function SignupBusinessPage() {
  const [step, setStep] = useState<Step>("account");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [businessData, setBusinessData] = useState<BusinessFormData | null>(null);
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

  function handleBusinessDataReady(data: BusinessFormData) {
    setBusinessData(data);
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
    if (!businessData) {
      setError("Business data is missing. Please go back and fill in business details.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: "sponsor",
          businessData: {
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
            photos: businessData.photos,
            hoursOfOperation: businessData.hoursOfOperation,
          },
        }),
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
    <div className="max-w-2xl mx-auto px-4 py-12">
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
        <div className="space-y-4">
          <p className="text-gray-600 mb-4">
            Add your business details. Same form as Business Hub—your business will appear in the directory after signup.
          </p>
          <BusinessForm
            mode="signup"
            onDataReady={handleBusinessDataReady}
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("account")} className="btn flex-1">
              Back
            </button>
          </div>
        </div>
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
