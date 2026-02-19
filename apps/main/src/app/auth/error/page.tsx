"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  Configuration: "There is a problem with the server configuration.",
  AccessDenied: "Access denied. You do not have permission to sign in.",
  Verification: "The sign-in link has expired or has already been used.",
  Default: "An error occurred during sign in.",
};

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams?.get("error") ?? "Default";
  const message = ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default;

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-6">Sign-in error</h1>
      <p className="text-gray-600 mb-8">{message}</p>
      <div className="flex flex-col sm:flex-row gap-3">
        <Link href="/login" className="btn flex-1 text-center">
          Try again
        </Link>
        <Link
          href="/"
          className="flex-1 text-center py-3 px-4 border rounded-md border-gray-300 text-gray-700 hover:bg-gray-50 font-medium transition-colors"
        >
          Go to Home
        </Link>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <div className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <Suspense fallback={<div className="max-w-md mx-auto px-4 py-12">Loading…</div>}>
          <AuthErrorContent />
        </Suspense>
      </div>
    </div>
  );
}
