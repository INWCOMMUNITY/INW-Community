"use client";

import Link from "next/link";
import { useEffect } from "react";

export type FeedToastPayload = {
  message: string;
  action?: { label: string; href: string };
};

export function FeedToast({
  toast,
  onDone,
}: {
  toast: FeedToastPayload | null;
  onDone: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(onDone, 4000);
    return () => window.clearTimeout(t);
  }, [toast, onDone]);

  if (!toast) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 z-[130] -translate-x-1/2 rounded-lg bg-black/85 px-5 py-3 text-sm font-medium text-white shadow-lg flex items-center gap-3 max-w-[min(100vw-2rem,24rem)]"
      role="status"
      aria-live="polite"
    >
      <span className="flex-1">{toast.message}</span>
      {toast.action ? (
        <Link
          href={toast.action.href}
          className="shrink-0 underline font-semibold whitespace-nowrap"
          onClick={onDone}
        >
          {toast.action.label}
        </Link>
      ) : null}
    </div>
  );
}
