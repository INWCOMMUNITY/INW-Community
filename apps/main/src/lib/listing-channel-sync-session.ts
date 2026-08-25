import type { ChannelSyncRow } from "@/lib/channel-sync-feedback";

const keyFor = (itemId: string) => `inw.listingChannelSync.${itemId}`;

function sessionStore(): Storage | null {
  try {
    const store = globalThis.sessionStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

/** Persist the last publish result so mixed create can show on the edit page after navigation. */
export function persistListingChannelSync(itemId: string, rows: ChannelSyncRow[]): void {
  if (!itemId || rows.length === 0) return;
  try {
    sessionStore()?.setItem(keyFor(itemId), JSON.stringify(rows));
  } catch {
    /* quota / private mode */
  }
}

export function consumeListingChannelSync(itemId: string): ChannelSyncRow[] | undefined {
  if (!itemId) return undefined;
  try {
    const store = sessionStore();
    if (!store) return undefined;
    const raw = store.getItem(keyFor(itemId));
    if (!raw) return undefined;
    store.removeItem(keyFor(itemId));
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter(
      (row): row is ChannelSyncRow =>
        Boolean(row) &&
        typeof row === "object" &&
        typeof (row as ChannelSyncRow).provider === "string" &&
        typeof (row as ChannelSyncRow).ok === "boolean"
    );
  } catch {
    return undefined;
  }
}
