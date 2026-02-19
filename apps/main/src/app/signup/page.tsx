"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

interface Tag {
  id: string;
  name: string;
  slug: string;
}

export default function SignupPage() {
  const searchParams = useSearchParams();
  const refCode = searchParams.get("ref") ?? undefined;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [retypePassword, setRetypePassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [city, setCity] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<Tag[]>([]);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/tags?limit=30")
      .then((r) => r.json())
      .then((data) => setTags(data.tags ?? []))
      .catch(() => setTags([]));
  }, []);

  function toggleTag(id: string) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!ageConfirmed) {
      setError("You must confirm you are 16 years or older to sign up.");
      return;
    }
    if (password !== retypePassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          firstName,
          lastName,
          city: city.trim() || undefined,
          tagIds: Array.from(selectedTagIds),
          ...(refCode && { ref: refCode }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      const message = typeof data?.error === "string" ? data.error : "Sign up failed. Please try again.";
      if (!res.ok) {
        setError(message);
        return;
      }
      const signInRes = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (signInRes?.ok) {
        window.location.href = "/my-community";
        return;
      }
      window.location.href = "/login?fromSignup=1";
    } catch {
      setError("Could not reach the server. Check your connection and that the app is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-6">Sign up</h1>

      <p className="text-gray-600 mb-4">Choose your account type</p>
      <div className="flex flex-col sm:flex-row gap-6 mb-8 justify-center items-center">
        <div className="flex flex-col items-center gap-2">
          <Link href="/signup/business" className="btn w-full sm:w-auto min-w-[200px] flex flex-col justify-center items-center whitespace-nowrap text-center py-4">
            <span>Business Sign Up</span>
            <span className="text-white font-normal">$25 a Month</span>
          </Link>
          <Link href="/sponsor-nwc" className="text-sm underline hover:no-underline" style={{ color: "var(--color-primary)" }}>
            Business Benefits
          </Link>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Link href="/signup/seller" className="btn w-full sm:w-auto min-w-[200px] flex flex-col justify-center items-center whitespace-nowrap text-center py-4">
            <span>Seller Sign Up</span>
            <span className="text-white font-normal">$40 a Month</span>
          </Link>
          <Link href="/sell-nwc" className="text-sm underline hover:no-underline" style={{ color: "var(--color-primary)" }}>
            Seller Benefits
          </Link>
        </div>
      </div>

      <p className="text-sm font-medium text-gray-600 mb-4">Sign up as Resident</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="firstName" className="block text-sm font-medium mb-1">First name</label>
          <input
            id="firstName"
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="lastName" className="block text-sm font-medium mb-1">Last name</label>
          <input
            id="lastName"
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="retypePassword" className="block text-sm font-medium mb-1">Retype password</label>
          <input
            id="retypePassword"
            type="password"
            value={retypePassword}
            onChange={(e) => setRetypePassword(e.target.value)}
            required
            minLength={8}
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="city" className="block text-sm font-medium mb-1">City of residence</label>
          <input
            id="city"
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="e.g. Spokane"
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
          <label className="block text-sm font-medium mb-2">Pick tags to personalize your feed (optional)</label>
          <p className="text-xs text-gray-500 mb-2">Posts with these tags will appear in your feed.</p>
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTag(t.id)}
                className={`px-3 py-1 rounded text-sm border ${
                  selectedTagIds.has(t.id) ? "bg-blue-100 border-blue-300" : "bg-white border-gray-300 hover:bg-gray-50"
                }`}
              >
                #{t.name}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <p className="text-sm text-gray-600">
          By signing up, you agree to our{" "}
          <Link href="/terms" className="underline hover:no-underline">Terms of Service</Link>
          {" "}and{" "}
          <Link href="/privacy" className="underline hover:no-underline">Privacy Policy</Link>.
        </p>
        <button type="submit" className="btn w-full" disabled={loading}>
          {loading ? "Creating account…" : "Sign up"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm">
        Already have an account? <Link href="/login" className="underline">Log in</Link>
      </p>
    </div>
  );
}
