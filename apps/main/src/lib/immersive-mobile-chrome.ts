/**
 * Routes that use an in-page app-style toolbar on mobile; hide global NWC header there.
 */
export function isImmersiveMobileChromeRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;

  // Store item detail (resale + storefront listings)
  if (/^\/resale\/[^/]+/.test(pathname)) return true;
  if (/^\/storefront\/[^/]+/.test(pathname)) return true;

  // Seller storefront detail pages
  if (/^\/support-local\/sellers\/[^/]+$/.test(pathname)) return true;

  // Business listing detail only (not directory index)
  if (/^\/support-local\/[^/]+$/.test(pathname) && !pathname.startsWith("/support-local/sellers")) {
    return true;
  }

  return false;
}

/** Listing editor and fulfillment hub use fixed action bars; hide the global NWC footer on those routes. */
export function shouldHideGlobalSiteFooter(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (pathname === "/seller-hub/store/new") return true;
  if (pathname === "/seller-hub/orders") return true;
  if (pathname.startsWith("/seller-hub/orders/")) return true;
  const match = pathname.match(/^\/seller-hub\/store\/([^/]+)$/);
  if (!match) return false;
  const segment = match[1];
  const keepFooter = new Set([
    "items",
    "manage",
    "payouts",
    "returns",
    "cancellations",
    "actions",
  ]);
  return !keepFooter.has(segment);
}
