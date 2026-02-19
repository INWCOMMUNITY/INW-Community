"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";

function SignOutFormInner() {
  const [signingOut, setSigningOut] = useState(false);
  const searchParams = useSearchParams();
  const callbackUrl = searchParams?.get("callbackUrl") ?? "/";

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut({ redirect: false });
      window.location.href = callbackUrl;
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-6">Sign out</h1>
      <p className="text-gray-600 mb-8">
        Are you sure you want to sign out?
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="btn flex-1"
        >
          {signingOut ? "Signing out…" : "Yes, sign out"}
        </button>
        <Link
          href="/"
          className="flex-1 text-center py-3 px-4 border rounded-md border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition-colors"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}

export default function SignOutPage() {
  return (
    <div className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <Suspense fallback={<div className="max-w-md mx-auto px-4 py-12">Loading…</div>}>
          <SignOutFormInner />
        </Suspense>
      </div>
    </div>
  );
}
