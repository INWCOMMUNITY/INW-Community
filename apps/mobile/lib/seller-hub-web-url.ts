import { NW_APP_CHROME, NW_APP_SHIPPO } from "./app-webview-params";

export type NwAppShippoMode = "reprint" | "purchase" | "another" | "bulk";

/**
 * Build absolute seller/resale hub URLs with mobile WebView query flags (Shippo auto-open + compact chrome).
 */
export function buildHubWebUrl(
  siteBase: string,
  pathname: string,
  opts: { nwAppShippo?: NwAppShippoMode; nwAppChrome?: boolean }
): string {
  const base = siteBase.replace(/\/$/, "");
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const u = new URL(path, `${base}/`);
  if (opts.nwAppShippo) u.searchParams.set(NW_APP_SHIPPO, opts.nwAppShippo);
  if (opts.nwAppChrome) u.searchParams.set(NW_APP_CHROME, "1");
  return u.toString();
}
