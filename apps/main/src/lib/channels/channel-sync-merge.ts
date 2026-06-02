import type { ChannelProvider, ChannelSyncResult } from "./types";

/** Merge per-provider results from content + inventory pushes (any failure wins). */
export function mergeChannelSyncResults(
  ...batches: ChannelSyncResult[][]
): ChannelSyncResult[] {
  const byProvider = new Map<ChannelProvider, ChannelSyncResult>();
  for (const batch of batches) {
    for (const r of batch) {
      const prev = byProvider.get(r.provider);
      if (!prev) {
        byProvider.set(r.provider, r);
        continue;
      }
      if (!r.ok) {
        byProvider.set(r.provider, {
          provider: r.provider,
          ok: false,
          error: r.error ?? prev.error,
        });
      } else if (prev.ok) {
        byProvider.set(r.provider, r);
      }
    }
  }
  return [...byProvider.values()];
}
