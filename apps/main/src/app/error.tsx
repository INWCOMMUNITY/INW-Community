"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  const isDb = /P1001|ECONNREFUSED|connect|password|authentication|relation.*does not exist/i.test(
    error?.message ?? ""
  );

  return (
    <div className="min-h-[50vh] flex items-center justify-center p-6">
      <div className="rounded-lg border border-red-200 bg-red-50 p-8 max-w-lg w-full">
        <h1 className="text-xl font-bold text-red-800 mb-2">HTTP 500 – Something went wrong</h1>
        <p className="text-red-700 text-sm mb-4 font-mono break-words">
          {error?.message ?? "An unexpected error occurred."}
        </p>
        {isDb && (
          <div className="text-red-600 text-xs mb-4 p-3 bg-red-100 rounded space-y-1">
            <p className="font-semibold">Database issue – try:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Ensure PostgreSQL is running</li>
              <li>Check DATABASE_URL in .env (password uses %21 for !)</li>
              <li>Run: <code className="bg-red-200 px-1">cd packages/database && pnpm exec prisma db push</code></li>
              <li>Test: <Link href="/api/health" className="underline">/api/health</Link></li>
            </ol>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={reset}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm font-medium"
          >
            Try again
          </button>
          <Link
            href="/"
            className="px-4 py-2 border border-gray-400 text-gray-700 rounded hover:bg-gray-50 text-sm font-medium"
          >
            Go to Home
          </Link>
          <Link
            href="/api/health"
            className="px-4 py-2 border border-gray-400 text-gray-700 rounded hover:bg-gray-50 text-sm font-medium"
          >
            Check /api/health
          </Link>
        </div>
      </div>
    </div>
  );
}
