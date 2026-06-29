/**
 * eBay Rate Limit Tracking
 *
 * eBay enforces these limits:
 * - OAuth token minting: 1,000/day (client_credentials), 50,000/day (refresh_token)
 * - Each listing: 250 revisions per calendar day
 *
 * This module tracks revision counts per SKU to warn before hitting limits.
 */

const EBAY_DAILY_REVISION_LIMIT = 250;

/** In-memory cache of revision counts per SKU per day. */
const revisionCounts = new Map<string, { date: string; count: number }>();

/** Get today's date string (UTC) for cache keys. */
function getTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Build a cache key for a SKU (includes date for daily reset). */
function getCacheKey(sku: string): string {
  return `${sku}:${getTodayUtc()}`;
}

/**
 * Check if a SKU has remaining revisions today.
 * Returns the current count and whether it's approaching/at the limit.
 */
export function checkRevisionLimit(sku: string): {
  count: number;
  remaining: number;
  atLimit: boolean;
  nearLimit: boolean;
} {
  const key = getCacheKey(sku);
  const entry = revisionCounts.get(key);
  const today = getTodayUtc();

  // Reset if from a different day
  if (!entry || entry.date !== today) {
    return {
      count: 0,
      remaining: EBAY_DAILY_REVISION_LIMIT,
      atLimit: false,
      nearLimit: false,
    };
  }

  const remaining = Math.max(0, EBAY_DAILY_REVISION_LIMIT - entry.count);
  return {
    count: entry.count,
    remaining,
    atLimit: entry.count >= EBAY_DAILY_REVISION_LIMIT,
    nearLimit: entry.count >= EBAY_DAILY_REVISION_LIMIT - 10,
  };
}

/**
 * Record a revision for a SKU.
 * Call this after every successful inventory/offer update.
 */
export function recordRevision(sku: string): void {
  const today = getTodayUtc();
  const key = getCacheKey(sku);
  const entry = revisionCounts.get(key);

  if (!entry || entry.date !== today) {
    revisionCounts.set(key, { date: today, count: 1 });
  } else {
    entry.count += 1;
  }

  // Cleanup old entries (from previous days) to prevent memory leaks
  cleanupOldEntries(today);
}

/** Remove entries from previous days. */
function cleanupOldEntries(today: string): void {
  // Only cleanup occasionally to avoid overhead
  if (Math.random() > 0.1) return;

  for (const [key, entry] of revisionCounts) {
    if (entry.date !== today) {
      revisionCounts.delete(key);
    }
  }
}

/**
 * Get all tracked SKUs with their current revision counts.
 * Useful for diagnostics.
 */
export function getRevisionStats(): { sku: string; count: number; date: string }[] {
  const today = getTodayUtc();
  const stats: { sku: string; count: number; date: string }[] = [];

  for (const [key, entry] of revisionCounts) {
    if (entry.date === today) {
      const sku = key.replace(`:${today}`, "");
      stats.push({ sku, count: entry.count, date: entry.date });
    }
  }

  return stats.sort((a, b) => b.count - a.count);
}

/**
 * Check if we should warn about approaching the revision limit.
 * Returns a warning message if applicable, null otherwise.
 */
export function getRevisionLimitWarning(sku: string): string | null {
  const { count, atLimit, nearLimit } = checkRevisionLimit(sku);

  if (atLimit) {
    return `eBay revision limit reached for SKU ${sku}. Each listing can only be revised 250 times per calendar day. Try again tomorrow.`;
  }

  if (nearLimit) {
    return `Warning: SKU ${sku} has ${count} revisions today (limit is 250). Consider reducing sync frequency.`;
  }

  return null;
}
