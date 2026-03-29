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
export function notifyNwAppShippoLabelSuccess(payload?: { orderId?: string; orderIds?: string[] }): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { ReactNativeWebView?: { postMessage: (data: string) => void } };
  if (!w.ReactNativeWebView?.postMessage) return;
  const body: NwAppShippoLabelSuccessPayload = {
    type: NW_APP_WEBVIEW_MSG_SHIPPO_LABEL_SUCCESS,
    ...payload,
  };
  w.ReactNativeWebView.postMessage(JSON.stringify(body));
}
