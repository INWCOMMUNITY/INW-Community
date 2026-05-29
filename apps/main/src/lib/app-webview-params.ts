/** Query params used when opening the seller hub in the mobile app WebView. */
export const NW_APP_SHIPPO = "nwAppShippo";
export const NW_APP_CHROME = "nwAppChrome";

/** Paths allowed for mobile → web session bridge (must stay logged-in seller surfaces). */
export function isAllowedWebviewBridgePath(path: string): boolean {
  const p = path.split("#")[0] ?? path;
  if (!p.startsWith("/") || p.includes("..")) return false;
  return p.startsWith("/seller-hub");
}
