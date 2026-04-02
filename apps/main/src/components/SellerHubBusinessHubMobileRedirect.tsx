"use client";

import { useLayoutEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Seller Hub used to duplicate Business Hub at /seller-hub/business-hub.
 * On viewports below `lg`, use the main /business-hub experience instead.
 */
export function SellerHubBusinessHubMobileRedirect() {
  const router = useRouter();

  useLayoutEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    if (mq.matches) {
      router.replace("/business-hub?from=seller-hub");
    }
  }, [router]);

  return null;
}
