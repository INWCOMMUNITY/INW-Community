"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function SponsorHubError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Sponsor Hub error:", error);
  }, [error]);

  const isDbError =
    error?.message?.includes("connect") ||
    error?.message?.includes("ECONNREFUSED") ||
    error?.message?.includes("P1001") ||
    error?.message?.includes("connection");

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 max-w-md mx-auto mt-12">
      <h2 className="text-lg font-semibold text-red-800 mb-2">This page isn&apos;t working</h2>
      <p className="text-red-700 text-sm mb-4">
        {error?.message ?? "We couldn't load the Sponsor Hub. Please try again."}
      </p>
      {isDbError && (
        <p className="text-red-600 text-xs mb-4 p-2 bg-red-100 rounded">
          Make sure PostgreSQL is running (check Services or run{" "}
          <code className="bg-red-200 px-1">net start postgresql-x64-16</code> as Administrator).
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm font-medium"
        >
          Try again
        </button>
        <Link
          href="/sponsor-hub"
          className="px-4 py-2 border border-red-600 text-red-600 rounded hover:bg-red-50 text-sm font-medium"
        >
          Back to Sponsor Hub
        </Link>
        <Link
          href="/"
          className="px-4 py-2 border border-gray-400 text-gray-700 rounded hover:bg-gray-50 text-sm font-medium"
        >
          Go to Home
        </Link>
      </div>
    </div>
  );
}
