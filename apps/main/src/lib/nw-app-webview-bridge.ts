"use client";

/** Must match handler in apps/mobile/app/web.tsx */
export const NW_APP_WEBVIEW_MSG_SHIPPO_LABEL_SUCCESS = "nw_shippo_label_success";

export type NwAppShippoLabelSuccessPayload = {
  type: typeof NW_APP_WEBVIEW_MSG_SHIPPO_LABEL_SUCCESS;
  orderId?: string;
  orderIds?: string[];
};

/**
 * When running inside the Expo WebView, notifies native to close the WebView (e.g. return to order list).
 * No-op in desktop browsers (ReactNativeWebView is undefined).
 */
type WebViewWindow = Window & { ReactNativeWebView?: { postMessage: (data: string) => void } };

export function isInsideNwAppWebView(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as WebViewWindow).ReactNativeWebView?.postMessage);
}

export function notifyNwAppShippoLabelSuccess(payload?: { orderId?: string; orderIds?: string[] }): void {
  if (typeof window === "undefined") return;
  const body: NwAppShippoLabelSuccessPayload = {
    type: NW_APP_WEBVIEW_MSG_SHIPPO_LABEL_SUCCESS,
    ...payload,
  };
  const json = JSON.stringify(body);
  const targets = new Set<WebViewWindow>();
  targets.add(window as WebViewWindow);
  try {
    if (window.parent) targets.add(window.parent as WebViewWindow);
  } catch {
    // cross-origin parent
  }
  try {
    if (window.top) targets.add(window.top as WebViewWindow);
  } catch {
    // cross-origin top
  }
  for (const target of targets) {
    target.ReactNativeWebView?.postMessage?.(json);
  }
}
