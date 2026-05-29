"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SellerHubTopNav } from "@/components/SellerHubTopNav";
import { NW_APP_CHROME } from "@/lib/app-webview-params";

type Variant = "seller";

/**
 * When `nwAppChrome=1` is present (mobile app WebView), hide hub top nav and use compact chrome
 * so the page matches the in-app seller experience.
 *
 * `useSearchParams` is isolated inside Suspense so layout `children` are never duplicated in a
 * fallback (that breaks Next.js App Router — parallelRouterKey null).
 */
function HubWebChromeInner({ children }: { variant?: Variant; children: React.ReactNode }) {
  const searchParams = useSearchParams();
  /** `useSearchParams()` can be `null` until the router is ready (Next.js client runtime). */
  const embed = searchParams?.get(NW_APP_CHROME) === "1";

  if (!embed) {
    return (
      <>
        <SellerHubTopNav />
        {children}
      </>
    );
  }

  return (
    <div
      className="min-h-[100dvh] bg-white [--section-padding:12px] sm:[--section-padding:16px]"
      data-nw-app-chrome="1"
    >
      {children}
    </div>
  );
}

export function HubWebChrome({ variant, children }: { variant?: Variant; children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <>
          <SellerHubTopNav />
          <div className="min-h-[40vh]" aria-hidden />
        </>
      }
    >
      <HubWebChromeInner variant={variant}>{children}</HubWebChromeInner>
    </Suspense>
  );
}
