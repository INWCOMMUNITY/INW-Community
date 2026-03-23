/** Keep in sync with apps/main/src/lib/app-webview-params.ts */
export const NW_APP_SHIPPO = "nwAppShippo";
export const NW_APP_CHROME = "nwAppChrome";

export function isHubWebviewBridgePath(path: string): boolean {
  const p = path.split("#")[0] ?? path;
  if (!p.startsWith("/") || p.includes("..")) return false;
  return p.startsWith("/seller-hub") || p.startsWith("/resale-hub");
}

export function siteOriginFromApiBase(apiBase: string): string {
  return apiBase.replace(/\/api.*$/, "").replace(/\/$/, "");
}

/** Same site only: returns pathname + search + hash, or null. */
export function sameOriginPathFromUrl(fullUrl: string, siteOrigin: string): string | null {
  try {
    const u = new URL(fullUrl);
    const o = new URL(siteOrigin.endsWith("/") ? siteOrigin : `${siteOrigin}/`);
    if (u.origin !== o.origin) return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}
