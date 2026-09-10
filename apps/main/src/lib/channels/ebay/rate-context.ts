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
 * IMPORTANT: `ebay/client.ts` (which imports this) is transitively reachable from client bundles
 * via pure helpers re-exported through `ebay/conditions.ts`. A static `import "node:async_hooks"`
 * is not bundleable for the browser (webpack UnhandledSchemeError). So we load AsyncLocalStorage
 * lazily at runtime on the server only; in the browser (and any runtime without a CJS require)
 * these helpers degrade to no-ops, which is correct because the client never calls eBay directly.
 */
type EbayRateStore = { connectionId: string };

type AsyncLocalStorageLike = {
  getStore(): EbayRateStore | undefined;
  run<T>(store: EbayRateStore, fn: () => T): T;
};

let cachedStore: AsyncLocalStorageLike | null | undefined;

function getConnectionStore(): AsyncLocalStorageLike | null {
  if (cachedStore !== undefined) return cachedStore;
  if (typeof window !== "undefined") {
    cachedStore = null;
    return null;
  }
  try {
    // Runtime require via eval so webpack never tries to statically bundle "async_hooks" (a Node
    // built-in) into the browser graph. Guarded by try/catch so non-Node runtimes fall back to a
    // no-op instead of throwing.
    // eslint-disable-next-line no-eval
    const nodeRequire = eval("require") as (id: string) => unknown;
    const mod = nodeRequire("async_hooks") as {
      AsyncLocalStorage: new () => AsyncLocalStorageLike;
    };
    cachedStore = new mod.AsyncLocalStorage();
  } catch {
    cachedStore = null;
  }
  return cachedStore;
}

/** Run `fn` with an eBay connection bound so nested eBay HTTP calls are rate-limited per shop. */
export function runWithEbayConnection<T>(connectionId: string, fn: () => Promise<T>): Promise<T> {
  const store = getConnectionStore();
  if (!connectionId || !store) return fn();
  return store.run({ connectionId }, fn);
}

/** The connection id bound to the current async scope, if any. */
export function currentEbayConnectionId(): string | null {
  return getConnectionStore()?.getStore()?.connectionId ?? null;
}

/** Pace the current eBay call against its connection's rate window (no-op when unbound). */
export async function paceEbayCall(): Promise<void> {
  const connectionId = currentEbayConnectionId();
  if (connectionId) await waitForRateLimit("ebay", connectionId);
}
