"use client";

import { useEffect } from "react";
import Link from "next/link";

/** Error boundary for old sponsor-hub route; suggest Business Hub. */
export default function SponsorHubError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Business Hub error:", error);
  }, [error]);

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 max-w-md mx-auto mt-12">
      <h2 className="text-lg font-semibold text-red-800 mb-2">This page isn&apos;t working</h2>
      <p className="text-red-700 text-sm mb-4">
        {error?.message ?? "We couldn't load the page. Please try again."}
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm font-medium"
        >
          Try again
        </button>
        <Link href="/business-hub" className="px-4 py-2 border border-red-600 text-red-600 rounded hover:bg-red-50 text-sm font-medium">
          Go to Business Hub
        </Link>
      </div>
    </div>
  );
}
