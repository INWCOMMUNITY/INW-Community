import { waitUntil } from "@vercel/functions";

/**
 * Push Socket.IO events after the HTTP response is sent on Vercel (lower perceived latency
 * for the sender). The publish still runs reliably via waitUntil. Locally, the promise
 * runs in the background on the long-lived dev server.
 */
export function scheduleRealtimePublish(promise: Promise<unknown>): void {
  const wrapped = promise.catch((e) => {
    console.warn("[scheduleRealtimePublish]", (e as Error)?.message ?? e);
  });
  if (process.env.VERCEL) {
    waitUntil(wrapped);
    return;
  }
  void wrapped;
}
