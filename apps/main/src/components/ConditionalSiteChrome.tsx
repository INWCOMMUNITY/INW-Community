"use client";

import { usePathname } from "next/navigation";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { isImmersiveMobileChromeRoute, shouldHideGlobalSiteFooter } from "@/lib/immersive-mobile-chrome";

export function ConditionalHeader() {
  return <Header />;
}

export function ConditionalFooter() {
  const pathname = usePathname();
  const hideOnMobile = isImmersiveMobileChromeRoute(pathname);
  const hideFooter = shouldHideGlobalSiteFooter(pathname);

  if (hideFooter) return null;

  return (
    <div className={hideOnMobile ? "max-md:hidden" : undefined}>
      <Footer />
    </div>
  );
}
