"use client";

import { usePathname } from "next/navigation";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { isImmersiveMobileChromeRoute } from "@/lib/immersive-mobile-chrome";

export function ConditionalHeader() {
  return <Header />;
}

export function ConditionalFooter() {
  const pathname = usePathname();
  const hideOnMobile = isImmersiveMobileChromeRoute(pathname);

  return (
    <div className={hideOnMobile ? "max-md:hidden" : undefined}>
      <Footer />
    </div>
  );
}
