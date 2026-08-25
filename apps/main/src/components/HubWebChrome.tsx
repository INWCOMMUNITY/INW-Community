"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { SellerHubTopNav } from "@/components/SellerHubTopNav";
import { NW_APP_CHROME } from "@/lib/app-webview-params";

type Variant = "seller";

/**
 * `useSearchParams` can suspend. Keep `children` (the App Router page slot) **outside**
 * that boundary — putting the slot in a Suspense fallback/inner swap blanks the page
 * (and duplicating the slot crashes with parallelRouterKey null).
 */
function HubChromeHeader() {
  const searchParams = useSearchParams();
  const embed = searchParams?.get(NW_APP_CHROME) === "1";

  useEffect(() => {
    if (!embed) return;
    document.documentElement.setAttribute("data-nw-app-chrome", "1");
    return () => document.documentElement.removeAttribute("data-nw-app-chrome");
  }, [embed]);

  if (embed) return null;
  return <SellerHubTopNav />;
}

export function HubWebChrome({ children }: { variant?: Variant; children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={<SellerHubTopNav />}>
        <HubChromeHeader />
      </Suspense>
      {children}
    </>
  );
}
