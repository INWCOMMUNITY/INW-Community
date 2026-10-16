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
    /** One Shippo label for every selected order from the same person and address. */
    combine?: boolean;
    /** Already grouped boxes. Each inner list is one shipment. */
    combinedGroups?: string[][];
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
  if (opts.combine) u.searchParams.set("combine", "1");
  if (opts.combinedGroups && opts.combinedGroups.length > 0) {
    u.searchParams.set("combined", opts.combinedGroups.map((group) => group.join("~")).join(","));
  }
  return u.toString();
}
