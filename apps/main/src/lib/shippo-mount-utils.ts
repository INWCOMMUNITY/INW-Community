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

/**
 * Size the Shippo iframe to the mount node so Next sits at the bottom of the
 * remaining viewport instead of a short default (~520–600px) panel.
 */
export function watchShippoElementsHeight(containerId: string): () => void {
  if (typeof document === "undefined") return () => {};

  let stopped = false;
  let observer: MutationObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const fillIframe = (root: HTMLElement) => {
    const iframe = root.querySelector("iframe");
    if (!iframe) return;
    const overlay = root.closest("[data-shippo-surface]");
    const chrome = overlay?.querySelector("[data-shippo-chrome]");
    const overlayH = overlay?.getBoundingClientRect().height
      ?? (window.visualViewport?.height ?? window.innerHeight);
    const chromeH = chrome?.getBoundingClientRect().height ?? 0;
    const fromMount = Math.round(root.getBoundingClientRect().height);
    const h = Math.max(fromMount, Math.round(overlayH - chromeH));
    if (h < 80) return;
    iframe.setAttribute("height", String(h));
    iframe.style.setProperty("height", `${h}px`, "important");
    iframe.style.setProperty("max-height", `${h}px`, "important");
    iframe.style.setProperty("width", "100%", "important");
    iframe.style.minHeight = "0";
    iframe.style.flex = "1 1 auto";
  };

  const attach = () => {
    if (stopped) return;
    const root = document.getElementById(containerId);
    if (!root) {
      requestAnimationFrame(attach);
      return;
    }
    observer = new MutationObserver(() => fillIframe(root));
    observer.observe(root, { childList: true, subtree: true });
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => fillIframe(root));
      resizeObserver.observe(root);
    }
    fillIframe(root);
  };

  const onViewportResize = () => {
    const root = document.getElementById(containerId);
    if (root) fillIframe(root);
  };

  attach();
  window.addEventListener("resize", onViewportResize);
  window.visualViewport?.addEventListener("resize", onViewportResize);

  return () => {
    stopped = true;
    observer?.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener("resize", onViewportResize);
    window.visualViewport?.removeEventListener("resize", onViewportResize);
  };
}
