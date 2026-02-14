"use client";

import Link from "next/link";

export default function SellerHubError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto text-center">
        <h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
        <p className="text-gray-600 mb-6">{error.message}</p>
        <div className="flex gap-4 justify-center">
          <button type="button" onClick={reset} className="btn">
            Try again
          </button>
          <Link href="/seller-hub" className="btn">
            Back to Seller Hub
          </Link>
        </div>
      </div>
    </section>
  );
}
