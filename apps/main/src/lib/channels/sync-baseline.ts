import { createHash } from "crypto";

/**
 * Differential two-way sync helpers.
 *
 * The reconciler stores a per-link baseline (content hash + quantity + timestamp) representing the
 * last agreed state between INW and the channel. On each pass it detects which side changed since
 * that baseline and pushes/pulls accordingly. When BOTH sides changed, the most-recently-edited side
 * wins. This replaces value-equality comparisons (which thrash because Wix re-hosts photos) and the
 * old "push when local is 0" rule (which wiped remote restocks).
 */

/** Fields that participate in INW <-> channel content sync (quantity is tracked separately). */
export type SyncContentInput = {
  title: string;
  description: string | null;
  priceCents: number;
  photos: string[];
};

/** Stable content fingerprint for one side (title, description, price, photos). */
export function syncContentHash(item: SyncContentInput): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        t: item.title ?? "",
        d: (item.description ?? "").trim(),
        p: item.priceCents ?? 0,
        ph: Array.isArray(item.photos) ? item.photos : [],
      })
    )
    .digest("hex");
}

export type SyncDirection = "push" | "pull" | "noop";

/**
 * Decide direction for a single aspect (content or quantity).
 * - only INW changed   -> push (INW -> channel)
 * - only channel changed -> pull (channel -> INW)
 * - both changed        -> most recent edit wins (INW wins when channel timestamp is unknown)
 */
export function resolveSyncDirection(args: {
  inwChanged: boolean;
  remoteChanged: boolean;
  inwUpdatedAt: Date | null;
  remoteUpdatedAt: Date | null;
}): SyncDirection {
  const { inwChanged, remoteChanged, inwUpdatedAt, remoteUpdatedAt } = args;
  if (!inwChanged && !remoteChanged) return "noop";
  if (inwChanged && !remoteChanged) return "push";
  if (!inwChanged && remoteChanged) return "pull";
  // Both sides changed since the baseline: newest write wins.
  if (!remoteUpdatedAt) return "push";
  if (!inwUpdatedAt) return "pull";
  return inwUpdatedAt.getTime() >= remoteUpdatedAt.getTime() ? "push" : "pull";
}

/**
 * After we push INW -> Wix, Wix's own updatedDate advances to ~now, which would look like a remote
 * edit on the next pass. Treat remote changes within this window after a push as our own echo.
 */
export const SYNC_ECHO_SKEW_MS = 120_000;
