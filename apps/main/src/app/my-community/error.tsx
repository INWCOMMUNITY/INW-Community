"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function MyCommunityError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("My Community error:", error);
  }, [error]);

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 max-w-md">
      <h2 className="text-lg font-semibold text-red-800 mb-2">Something went wrong</h2>
      <p className="text-red-700 text-sm mb-4">
        We couldn&apos;t load My Community. Please try again.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm font-medium"
        >
          Try again
        </button>
        <Link
          href="/my-community"
          className="px-4 py-2 border border-red-600 text-red-600 rounded hover:bg-red-50 text-sm font-medium"
        >
          Back to My Community
        </Link>
      </div>
    </div>
  );
}
