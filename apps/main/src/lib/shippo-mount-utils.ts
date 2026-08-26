import { NWC_SHIPPO_IFRAME_HEIGHT_PX } from "@/lib/shippo-elements-theme";

/** Clear Shippo embed mount nodes so the next `labelPurchase` gets a fresh DOM target. */
export function clearShippoElementsMount(containerId: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = "";
}

/** Wait for the browser to paint so `#containerId` exists before Shippo mounts widgets. */
export function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function isShippoOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "goshippo.com" || host.endsWith(".goshippo.com");
  } catch {
    return false;
  }
}

function embedHeightFromMessage(data: unknown): number | null {
  if (typeof data === "number" && data > 80 && data < 8000) return data;
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  for (const key of ["height", "iframeHeight", "contentHeight"]) {
    const v = o[key];
    if (typeof v === "number" && v > 80 && v < 8000) return v;
    if (typeof v === "string" && /^\d+(\.\d+)?px$/.test(v)) {
      const n = parseFloat(v);
      if (n > 80 && n < 8000) return n;
    }
  }
  if (o.data) return embedHeightFromMessage(o.data);
  if (o.payload) return embedHeightFromMessage(o.payload);
  return null;
}

/**
 * Stop the Shippo iframe from inheriting the full viewport (empty white under Next).
 * Clears 100% heights and applies resize postMessages from widgets.goshippo.com.
 */
export function watchShippoElementsHeight(containerId: string): () => void {
  if (typeof document === "undefined") return () => {};

  let stopped = false;
  let observer: MutationObserver | null = null;

  const applyCompactHeight = (iframe: HTMLIFrameElement, px?: number) => {
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    const cap = Math.max(360, Math.round(viewport - 56));
    const target = Math.min(px ?? NWC_SHIPPO_IFRAME_HEIGHT_PX, NWC_SHIPPO_IFRAME_HEIGHT_PX, cap);
    iframe.setAttribute("height", String(target));
    iframe.style.setProperty("height", `${target}px`, "important");
    iframe.style.setProperty("max-height", `min(${target}px, calc(100svh - 3.5rem))`, "important");
    iframe.style.width = "100%";
    iframe.style.minHeight = "0";
    iframe.style.flex = "none";
  };

  const relaxIframe = (root: HTMLElement) => {
    const iframe = root.querySelector("iframe");
    if (!iframe) return;
    applyCompactHeight(iframe);
  };

  const onMessage = (event: MessageEvent) => {
    if (!isShippoOrigin(event.origin)) return;
    const height = embedHeightFromMessage(event.data);
    if (height == null) return;
    const root = document.getElementById(containerId);
    const iframe = root?.querySelector("iframe");
    if (!iframe) return;
    applyCompactHeight(iframe, height);
  };

  const attach = () => {
    if (stopped) return;
    const root = document.getElementById(containerId);
    if (!root) {
      requestAnimationFrame(attach);
      return;
    }
    observer = new MutationObserver(() => relaxIframe(root));
    observer.observe(root, {
      childList: true,
      subtree: true,
    });
    relaxIframe(root);
  };

  attach();
  window.addEventListener("message", onMessage);

  return () => {
    stopped = true;
    observer?.disconnect();
    window.removeEventListener("message", onMessage);
  };
}
