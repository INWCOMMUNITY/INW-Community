"use client";

import { useSearchParams } from "next/navigation";
import { SellerHubTopNav } from "@/components/SellerHubTopNav";
import { ResaleHubTopNav } from "@/components/ResaleHubTopNav";
import { NW_APP_CHROME } from "@/lib/app-webview-params";

type Variant = "seller" | "resale";

/**
 * When `nwAppChrome=1` is present (mobile app WebView), hide hub top nav and use compact chrome
 * so the page matches the in-app seller/resale experience.
 */
export function HubWebChrome({ variant, children }: { variant: Variant; children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const embed = searchParams.get(NW_APP_CHROME) === "1";
  const Nav = variant === "seller" ? SellerHubTopNav : ResaleHubTopNav;

  if (!embed) {
    return (
      <>
        <Nav />
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
