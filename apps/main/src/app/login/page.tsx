"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const searchParams = useSearchParams();
  const callbackUrl = searchParams?.get("callbackUrl") ?? "/my-community";
  const fromSignup = searchParams?.get("fromSignup") === "1";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (res?.error) {
        setError("Invalid email or password. Don't have an account? Sign up first.");
        return;
      }
      if (res?.ok) {
        // Full page redirect ensures server receives session cookie (fixes redirect loop)
        window.location.href = callbackUrl;
        return;
      }
      setError("Something went wrong. Please try again.");
    } catch {
      setError("Could not connect. Check your connection and try again.");
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-6">Log in</h1>
      {fromSignup && (
        <p className="mb-4 p-3 rounded-lg text-sm" style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}>
          Account created. Sign in below to continue to My Community.
        </p>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
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
            className="w-full border rounded px-3 py-2"
          />
        </div>
        {error && (
          <p className="text-red-600 text-sm">
            {error}
            {error.includes("Sign up first") && (
              <> <Link href="/signup" className="underline">Sign up</Link></>
            )}
          </p>
        )}
        <button type="submit" className="btn w-full">Log in</button>
      </form>
      <p className="mt-4 text-center text-sm">
        Don&apos;t have an account? <Link href="/signup" className="underline">Sign up</Link>
      </p>
      <p className="mt-4 text-center text-xs">
        <Link href="/terms" className="underline opacity-80">Terms</Link>
        <span className="mx-1">·</span>
        <Link href="/privacy" className="underline opacity-80">Privacy</Link>
      </p>
      <p className="mt-3 text-center text-xs text-gray-500">
        Test: universal@nwc.local / Universal123! (run <code className="bg-gray-100 px-1 rounded">pnpm db:seed</code> first)
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto px-4 py-12">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
