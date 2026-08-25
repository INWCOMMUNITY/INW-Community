/**
 * Daily API quota tracking and alerting for channel providers.
 * 
 * Etsy limits: 10,000 requests/day (sliding 24-hour window)
 * This tracker monitors usage and alerts when approaching limits.
 * 
 * Uses in-memory tracking plus ChannelQuotaUsage so skip decisions survive cold starts.
 */

import { prisma } from "database";
import type { ChannelProvider } from "./types";

/** Provider daily limits (requests per 24-hour sliding window) */
const DAILY_LIMITS: Record<ChannelProvider, number> = {
  etsy: 10_000,
  shopify: 40_000, // Based on 2/sec * 60 * 60 * 24 / 2 (conservative)
  wix: 100_000,
  ebay: 15_000,
};

/** Alert thresholds as percentages */
const ALERT_THRESHOLDS = {
  warning: 70,  // 70% - getting close
  critical: 90, // 90% - approaching limit
  exceeded: 100,
};

/** In-memory cache for current day's usage (reset at midnight UTC or on deploy) */
const usageCache = new Map<ChannelProvider, {
  count: number;
  date: string; // YYYY-MM-DD
  lastUpdated: number;
}>();

/** Get today's date string in UTC */
function getTodayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 
 * Record an API request for quota tracking.
 * Call this after each successful API call to a provider.
 */
export function recordDailyRequest(
  provider: ChannelProvider,
  requestCount = 1
): void {
  const today = getTodayUTC();
  const cached = usageCache.get(provider);

  // Reset cache if it's a new day
  if (cached && cached.date !== today) {
    usageCache.delete(provider);
  }

  const current = usageCache.get(provider) || { count: 0, date: today, lastUpdated: 0 };
  current.count += requestCount;
  current.lastUpdated = Date.now();
  usageCache.set(provider, current);
  void prisma.channelQuotaUsage
    .upsert({
      where: { provider_dateUtc: { provider, dateUtc: today } },
      create: { provider, dateUtc: today, requestCount: current.count },
      update: { requestCount: current.count },
    })
    .catch(() => {});
}

/** Get current usage from cache */
export function getDailyUsage(provider: ChannelProvider): {
  count: number;
  limit: number;
  percentUsed: number;
  remaining: number;
  date: string;
} {
  const today = getTodayUTC();
  const limit = DAILY_LIMITS[provider];
  
  const cached = usageCache.get(provider);
  
  // Reset if new day
  if (cached && cached.date !== today) {
    usageCache.delete(provider);
    return {
      count: 0,
      limit,
      percentUsed: 0,
      remaining: limit,
      date: today,
    };
  }
  
  const count = cached?.count || 0;
  return {
    count,
    limit,
    percentUsed: Math.round((count / limit) * 100),
    remaining: Math.max(0, limit - count),
    date: today,
  };
}

/**
 * Calculate projected daily usage based on current connections and listings.
 */
export async function getProjectedUsage(provider: ChannelProvider): Promise<{
  connectionsCount: number;
  totalListings: number;
  requestsPerSync: number;
  syncsPerDay: number;
  projectedDaily: number;
  limit: number;
  percentOfLimit: number;
  willExceed: boolean;
}> {
  // Get active connections for this provider
  const connections = await prisma.channelConnection.findMany({
    where: { provider, status: { not: "disconnected" } },
    include: {
      _count: { select: { listingLinks: { where: { syncEnabled: true } } } },
    },
  });

  const connectionsCount = connections.length;
  const totalListings = connections.reduce((sum, c) => sum + c._count.listingLinks, 0);
  
  // Estimate requests per sync:
  // - 1 request per 100 listings (batch listing endpoint)
  // - Plus ~1 request for sales check per connection
  const requestsPerSync = Math.ceil(totalListings / 100) + connectionsCount;
  
  // Syncs per day: every 5 minutes = 288 syncs/day
  const syncsPerDay = 288;
  
  const projectedDaily = requestsPerSync * syncsPerDay;
  const limit = DAILY_LIMITS[provider];

  return {
    connectionsCount,
    totalListings,
    requestsPerSync,
    syncsPerDay,
    projectedDaily,
    limit,
    percentOfLimit: Math.round((projectedDaily / limit) * 100),
    willExceed: projectedDaily > limit,
  };
}

/**
 * Check quota status and return alert level if needed.
 */
export async function checkQuotaAlert(provider: ChannelProvider): Promise<{
  alertLevel: "ok" | "warning" | "critical" | "exceeded";
  message: string | null;
  usage: ReturnType<typeof getDailyUsage>;
  projected: Awaited<ReturnType<typeof getProjectedUsage>>;
}> {
  const usage = await getDailyUsage(provider);
  const projected = await getProjectedUsage(provider);

  let alertLevel: "ok" | "warning" | "critical" | "exceeded" = "ok";
  let message: string | null = null;

  // Check actual usage
  if (usage.percentUsed >= ALERT_THRESHOLDS.exceeded) {
    alertLevel = "exceeded";
    message = `🚨 ${provider.toUpperCase()} QUOTA EXCEEDED: ${usage.count.toLocaleString()}/${usage.limit.toLocaleString()} requests (${usage.percentUsed}%). Sync paused until quota resets.`;
  } else if (usage.percentUsed >= ALERT_THRESHOLDS.critical) {
    alertLevel = "critical";
    message = `⚠️ ${provider.toUpperCase()} quota critical: ${usage.count.toLocaleString()}/${usage.limit.toLocaleString()} requests (${usage.percentUsed}%). Only ${usage.remaining.toLocaleString()} remaining today.`;
  } else if (usage.percentUsed >= ALERT_THRESHOLDS.warning) {
    alertLevel = "warning";
    message = `📊 ${provider.toUpperCase()} quota warning: ${usage.count.toLocaleString()}/${usage.limit.toLocaleString()} requests (${usage.percentUsed}%).`;
  }
  
  // Also warn about projected usage
  if (alertLevel === "ok" && projected.willExceed) {
    alertLevel = "warning";
    message = `📈 ${provider.toUpperCase()} projected to exceed quota: ${projected.projectedDaily.toLocaleString()}/${projected.limit.toLocaleString()} requests/day based on ${projected.totalListings} listings across ${projected.connectionsCount} connections.`;
  }

  return { alertLevel, message, usage, projected };
}

/**
 * Check all providers and return any alerts.
 */
export async function checkAllQuotaAlerts(): Promise<Array<{
  provider: ChannelProvider;
  alertLevel: "ok" | "warning" | "critical" | "exceeded";
  message: string | null;
  usage: ReturnType<typeof getDailyUsage>;
  projected: Awaited<ReturnType<typeof getProjectedUsage>>;
}>> {
  const providers: ChannelProvider[] = ["etsy", "ebay", "shopify", "wix"];
  const alerts = await Promise.all(
    providers.map(async (provider) => ({
      provider,
      ...(await checkQuotaAlert(provider)),
    }))
  );

  // Only return non-ok alerts
  return alerts.filter((a) => a.alertLevel !== "ok");
}

/**
 * Load persisted counts into memory. Call at cron start.
 */
export async function hydrateQuotaFromDb(): Promise<void> {
  const today = getTodayUTC();
  try {
    const rows = await prisma.channelQuotaUsage.findMany({ where: { dateUtc: today } });
    for (const row of rows) {
      usageCache.set(row.provider as ChannelProvider, {
        count: row.requestCount,
        date: today,
        lastUpdated: Date.now(),
      });
    }
  } catch (e) {
    console.warn("[quota] hydrate failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function persistQuotaToDb(): Promise<void> {
  const today = getTodayUTC();
  for (const [provider, cached] of usageCache) {
    if (cached.date !== today) continue;
    await prisma.channelQuotaUsage
      .upsert({
        where: { provider_dateUtc: { provider, dateUtc: today } },
        create: { provider, dateUtc: today, requestCount: cached.count },
        update: { requestCount: cached.count },
      })
      .catch(() => {});
  }
}

/**
 * Should we skip sync due to quota exhaustion?
 * Empty memory (cold start, not yet hydrated) must not skip — that would starve Etsy falsely.
 */
export function shouldSkipSyncDueToQuota(provider: ChannelProvider): boolean {
  const cached = usageCache.get(provider);
  if (!cached || cached.count <= 0) return false;
  const usage = getDailyUsage(provider);
  return usage.percentUsed >= 95;
}
