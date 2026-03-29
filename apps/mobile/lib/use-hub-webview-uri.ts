import { useEffect, useState } from "react";
import { API_BASE, apiPost } from "./api";
import {
  isHubWebviewBridgePath,
  sameOriginPathFromUrl,
  siteOriginFromApiBase,
} from "./app-webview-params";

/**
 * Resolves the URL to load in a WebView: for seller/resale hub paths, exchanges session via
 * webview-bridge when possible so the user stays signed in.
 */
export function useHubWebviewUri(resolvedUrl: string): string | null {
  const [webViewUri, setWebViewUri] = useState<string | null>(null);

  useEffect(() => {
    if (!resolvedUrl) {
      setWebViewUri(null);
      return;
    }
    const origin = siteOriginFromApiBase(API_BASE);
    const path = sameOriginPathFromUrl(resolvedUrl, origin);
    if (!path || !isHubWebviewBridgePath(path.split("#")[0] ?? "")) {
      setWebViewUri(resolvedUrl);
      return;
    }
    let cancelled = false;
    const nextPath = path.split("#")[0];
    (async () => {
      try {
        const data = await apiPost<{ redirectUrl?: string }>("/api/auth/webview-bridge", {
          next: nextPath,
        });
        if (!cancelled && data.redirectUrl) {
          setWebViewUri(data.redirectUrl);
          return;
        }
      } catch {
        // fall through to direct URL (user may need to sign in on web)
      }
      if (!cancelled) setWebViewUri(resolvedUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [resolvedUrl]);

  return webViewUri;
}
