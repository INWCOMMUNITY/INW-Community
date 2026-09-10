import { AsyncLocalStorage } from "node:async_hooks";
import { waitForRateLimit } from "../rate-limit-tracker";

/**
 * eBay rate-limit context.
 *
 * Unlike the REST/Trading access-token calls, eBay's clients never carried a connection id, so
 * they bypassed `waitForRateLimit` entirely and could burst straight into 429s. We thread the
 * connection id through an AsyncLocalStorage scope (not a module-global like the Etsy client, so
 * concurrent connections in one cron invocation keep independent rate windows) and pace each
 * eBay HTTP call against that connection's sliding window.
 *
 * This module imports the Node-only `async_hooks`, so it must stay server-only: nothing that
 * reaches a client bundle may import `ebay/client.ts` (see `ebay/condition-sync-error.ts`).
 */
const store = new AsyncLocalStorage<{ connectionId: string }>();

/** Run `fn` with an eBay connection bound so nested eBay HTTP calls are rate-limited per shop. */
export function runWithEbayConnection<T>(connectionId: string, fn: () => Promise<T>): Promise<T> {
  if (!connectionId) return fn();
  return store.run({ connectionId }, fn);
}

/** The connection id bound to the current async scope, if any. */
export function currentEbayConnectionId(): string | null {
  return store.getStore()?.connectionId ?? null;
}

/** Pace the current eBay call against its connection's rate window (no-op when unbound). */
export async function paceEbayCall(): Promise<void> {
  const connectionId = currentEbayConnectionId();
  if (connectionId) await waitForRateLimit("ebay", connectionId);
}
