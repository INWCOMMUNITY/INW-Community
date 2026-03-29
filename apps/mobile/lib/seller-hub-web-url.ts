import { NW_APP_CHROME, NW_APP_SHIPPO } from "./app-webview-params";

export type NwAppShippoMode = "reprint" | "purchase" | "another" | "bulk";

/**
 * Build absolute seller/resale hub URLs with mobile WebView query flags (Shippo auto-open + compact chrome).
 */
export function buildHubWebUrl(
  siteBase: string,
  pathname: string,
  opts: {
    nwAppShippo?: NwAppShippoMode;
    nwAppChrome?: boolean;
    returnTo?: string;
    /** Pass-through for `/seller-hub/orders/shippo-bulk` (comma-separated order ids). */
    bulkOrderIds?: string[];
  }
): string {
  const base = siteBase.replace(/\/$/, "");
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const u = new URL(path, `${base}/`);
  if (opts.nwAppShippo) u.searchParams.set(NW_APP_SHIPPO, opts.nwAppShippo);
  if (opts.nwAppChrome) u.searchParams.set(NW_APP_CHROME, "1");
  if (opts.returnTo) u.searchParams.set("returnTo", opts.returnTo);
  if (opts.bulkOrderIds && opts.bulkOrderIds.length > 0) {
    u.searchParams.set("bulkOrderIds", opts.bulkOrderIds.join(","));
  }
  return u.toString();
}
