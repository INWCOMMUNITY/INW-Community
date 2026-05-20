/**
 * Routes that use an in-page app-style toolbar on mobile; hide global NWC header there.
 */
export function isImmersiveMobileChromeRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;

  // Store item detail (resale + storefront listings)
  if (/^\/resale\/[^/]+/.test(pathname)) return true;
  if (/^\/storefront\/[^/]+/.test(pathname)) return true;

  // Business listing detail only (not directory index or sellers subtree)
  if (
    /^\/support-local\/[^/]+$/.test(pathname) &&
    !pathname.startsWith("/support-local/sellers")
  ) {
    return true;
  }

  return false;
}
