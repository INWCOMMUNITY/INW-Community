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
  const hideMessagesMobile = pathname.startsWith("/my-community/messages");

  if (hideFooter) return null;

  return (
    <div className={hideOnMobile || hideMessagesMobile ? "max-md:hidden" : undefined}>
      <Footer />
    </div>
  );
}
