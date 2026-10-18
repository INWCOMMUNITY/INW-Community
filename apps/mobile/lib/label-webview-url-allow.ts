/**
 * Keep the label WebView on the Shippo thin page (and auth), not other seller-hub order routes.
 */
export function isAllowedShippoLabelWebviewUrl(url: string, siteBase: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "about:") return true;
    const normalized = siteBase.startsWith("http") ? siteBase : `https://${siteBase}`;
    const siteOrigin = new URL(normalized.endsWith("/") ? normalized : `${normalized}/`).origin;
    if (u.origin !== siteOrigin) return true;
    const p = u.pathname;
    if (p.startsWith("/seller-hub/orders/") && !p.startsWith("/seller-hub/orders/shippo/")) {
      return false;
    }
    // A saved return label used to navigate here inside the WebView, which left
    // the purchase screen open and hid the success message.
    if (p.startsWith("/seller-hub/store/")) return false;
    return true;
  } catch {
    return true;
  }
}
