"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const APP_SCHEME = "inwcommunity://stripe-connect-return";

function sanitizePath(raw: string | null): string {
  const path = (raw ?? "/seller-hub").trim().split("?")[0]?.split("#")[0] ?? "";
  if (!path.startsWith("/") || path.includes("..") || path.includes("//")) {
    return "/seller-hub";
  }
  if (!/^\/(seller-hub|resale-hub)(\/|$)/.test(path)) {
    return "/seller-hub";
  }
  return path;
}

function StripeConnectAppReturnContent() {
  const searchParams = useSearchParams();
  const path = sanitizePath(searchParams.get("path"));
  const success = searchParams.get("success") === "1";
  const refresh = searchParams.get("refresh") === "1";

  const appUrl = useMemo(() => {
    const q = new URLSearchParams();
    q.set("path", path);
    if (success) q.set("success", "1");
    if (refresh) q.set("refresh", "1");
    return `${APP_SCHEME}?${q.toString()}`;
  }, [path, success, refresh]);

  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    setAttempted(true);
    window.location.href = appUrl;
  }, [appUrl]);

  return (
    <section className="py-12 px-4 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-2">Return to app</h1>
      <p className="text-gray-600 mb-4">
        {attempted ? "Opening the INW Community app…" : "Preparing to open the app…"}
      </p>
      <p className="text-gray-600 mb-4">
        If nothing happens,{" "}
        <a href={appUrl} className="text-[var(--color-link)] underline font-medium">
          tap here to continue in the app
        </a>
        .
      </p>
    </section>
  );
}

export default function StripeConnectAppReturnPage() {
  return (
    <Suspense fallback={<section className="py-12 px-4"><p className="text-gray-500">Loading…</p></section>}>
      <StripeConnectAppReturnContent />
    </Suspense>
  );
}
