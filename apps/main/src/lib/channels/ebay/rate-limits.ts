/**
 * eBay Rate Limit Tracking
 *
 * eBay enforces these limits:
 * - OAuth token minting: 1,000/day (client_credentials), 50,000/day (refresh_token)
 * - Each listing: 250 revisions per calendar day
 *
 * Counts are kept in-memory and mirrored onto ChannelConnection.config.revisionBySku
 * so multi-instance / cold starts stay approximately correct.
 */

import { prisma, Prisma } from "database";

export const EBAY_DAILY_REVISION_LIMIT = 250;

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

type RevisionConfig = {
  revisionDay?: string;
  revisionBySku?: Record<string, number>;
};

function readRevisionConfig(config: unknown): RevisionConfig {
  if (!config || typeof config !== "object") return {};
  const c = config as Record<string, unknown>;
  const revisionDay = typeof c.revisionDay === "string" ? c.revisionDay : undefined;
  const revisionBySku =
    c.revisionBySku && typeof c.revisionBySku === "object"
      ? (c.revisionBySku as Record<string, number>)
      : undefined;
  return { revisionDay, revisionBySku };
}

/** Hydrate in-memory counts from a connection config blob. */
export function hydrateRevisionCountsFromConfig(config: unknown): void {
  const { revisionDay, revisionBySku } = readRevisionConfig(config);
  const today = getTodayUtc();
  if (!revisionDay || revisionDay !== today || !revisionBySku) return;
  for (const [sku, count] of Object.entries(revisionBySku)) {
    if (typeof count === "number" && count > 0) {
      revisionCounts.set(getCacheKey(sku), { date: today, count });
    }
  }
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
 * Record a revision for a SKU (in-memory).
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

  cleanupOldEntries(today);
}

/** Persist today's revision map onto the connection config (best-effort). */
export async function persistRevisionCount(
  connectionId: string,
  sku: string,
  currentConfig: unknown
): Promise<void> {
  recordRevision(sku);
  const today = getTodayUtc();
  const base =
    currentConfig && typeof currentConfig === "object"
      ? { ...(currentConfig as Record<string, unknown>) }
      : {};
  const prev = readRevisionConfig(base);
  const bySku =
    prev.revisionDay === today && prev.revisionBySku
      ? { ...prev.revisionBySku }
      : {};
  bySku[sku] = checkRevisionLimit(sku).count;
  base.revisionDay = today;
  base.revisionBySku = bySku;
  await prisma.channelConnection
    .update({
      where: { id: connectionId },
      data: { config: base as Prisma.InputJsonValue },
    })
    .catch((e) =>
      console.warn("[ebay] persistRevisionCount failed", {
        connectionId,
        sku,
        error: String(e),
      })
    );
}

/** Remove entries from previous days. */
function cleanupOldEntries(today: string): void {
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
