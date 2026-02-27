"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

const APP_SCHEME = "inwcommunity://auth";
const PLANS = [
  { value: "subscribe", label: "Resident" },
  { value: "sponsor", label: "Business" },
  { value: "seller", label: "Seller" },
] as const;

function MobileLoginForm() {
  const searchParams = useSearchParams();
  const planParam = (searchParams?.get("plan") ?? "subscribe") as "subscribe" | "sponsor" | "seller";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [plan, setPlan] = useState<"subscribe" | "sponsor" | "seller">(
    PLANS.some((p) => p.value === planParam) ? planParam : "subscribe"
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/mobile-signin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          plan,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data.error as string) || "Sign in failed. Please try again.");
        return;
      }
      if (!data.token) {
        setError("Invalid response. Please try again.");
        return;
      }
      const redirectUrl = `${APP_SCHEME}?token=${encodeURIComponent(data.token)}`;
      window.location.href = redirectUrl;
    } catch {
      setError("Could not connect. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-2">Sign in to INW Community app</h1>
      <p className="text-sm text-gray-600 mb-6">
        Use the same email and password as the website. After signing in you’ll return to the app.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="plan" className="block text-sm font-medium mb-1">
            Sign in as
          </label>
          <select
            id="plan"
            value={plan}
            onChange={(e) => setPlan(e.target.value as "subscribe" | "sponsor" | "seller")}
            className="w-full border rounded px-3 py-2"
          >
            {PLANS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p className="text-red-600 text-sm">{error}</p>
        )}
        <button type="submit" className="btn w-full" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function MobileLoginPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto px-4 py-12">Loading…</div>}>
      <MobileLoginForm />
    </Suspense>
  );
}
