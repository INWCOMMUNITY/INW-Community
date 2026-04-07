"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import Image from "next/image";

function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok && data.error) {
        setError(data.error);
        return;
      }
      setMessage(
        typeof data.message === "string"
          ? data.message
          : "If that email is registered, we sent reset instructions."
      );
      setEmail("");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-12 flex flex-col items-center w-full">
      <Link
        href="/login"
        className="self-start flex items-center gap-2 text-sm font-medium mb-6"
        style={{ color: "var(--color-primary)" }}
      >
        ← Back to sign in
      </Link>
      <Image
        src="/nwc-logo-circle-crop.png"
        alt="Northwest Community"
        width={100}
        height={100}
        className="object-contain mb-4"
      />
      <h1 className="text-2xl font-bold mb-2 text-center" style={{ color: "var(--color-heading)" }}>
        Forgot password
      </h1>
      <p className="text-sm text-center mb-6 text-gray-600">
        Enter the email you use for your account. We&apos;ll send instructions to reset your password (web and mobile
        app). After a successful reset, a new reset email is typically available again after about 30 days.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4 w-full">
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
            className="w-full border rounded px-3 py-2 border-gray-300"
          />
        </div>
        {error ? <p className="text-red-600 text-sm">{error}</p> : null}
        {message ? (
          <p className="text-sm p-3 rounded-lg border border-green-200 bg-green-50 text-green-900">{message}</p>
        ) : null}
        <button type="submit" className="btn w-full" disabled={loading}>
          {loading ? "Sending…" : "Send reset instructions"}
        </button>
      </form>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto px-4 py-12">Loading…</div>}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
