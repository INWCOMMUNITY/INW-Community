"use client";

import { useSearchParams } from "next/navigation";

/**
 * Next.js 14 can return `null` from useSearchParams() until the client router is ready.
 * Use this helper instead of calling `.get()` directly on the hook result.
 */
export function useSafeSearchParams() {
  const searchParams = useSearchParams();
  return {
    searchParams,
    get: (key: string) => searchParams?.get(key) ?? null,
    getAll: (key: string) => searchParams?.getAll(key) ?? [],
    has: (key: string) => searchParams?.has(key) ?? false,
  };
}
