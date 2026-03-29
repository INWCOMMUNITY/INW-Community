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
