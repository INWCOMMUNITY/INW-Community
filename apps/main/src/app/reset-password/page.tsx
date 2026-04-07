"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams?.get("token")?.trim() ?? "";
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!token) {
      setError("This link is missing a token. Open the link from your email, or request a new reset.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== password2) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not reset password.");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!token && !done) {
    return (
      <div className="max-w-md mx-auto px-4 py-12">
        <p className="text-red-600 text-sm mb-4">Invalid or missing reset link.</p>
        <Link href="/forgot-password" className="underline font-semibold" style={{ color: "var(--color-primary)" }}>
          Request a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 flex flex-col items-center text-center">
        <p className="text-lg font-semibold mb-2" style={{ color: "var(--color-heading)" }}>
          Password updated
        </p>
        <p className="text-gray-600 mb-6">You can sign in with your new password.</p>
        <Link href="/login" className="btn inline-block">
          Go to sign in
        </Link>
      </div>
    );
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
        Choose a new password
      </h1>
      <form onSubmit={handleSubmit} className="space-y-4 w-full mt-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1">
            New password (min 8 characters)
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full border rounded px-3 py-2 border-gray-300"
          />
        </div>
        <div>
          <label htmlFor="password2" className="block text-sm font-medium mb-1">
            Confirm password
          </label>
          <input
            id="password2"
            type="password"
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            required
            minLength={8}
            className="w-full border rounded px-3 py-2 border-gray-300"
          />
        </div>
        {error ? <p className="text-red-600 text-sm">{error}</p> : null}
        <button type="submit" className="btn w-full" disabled={loading}>
          {loading ? "Saving…" : "Update password"}
        </button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto px-4 py-12">Loading…</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
