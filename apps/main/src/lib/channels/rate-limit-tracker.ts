/**
 * Proactive rate limit tracking for channel APIs.
 * Uses a sliding window algorithm to track requests and prevent hitting rate limits.
 */

import type { ChannelProvider } from "./types";

/**
 * Rate limit configuration per provider.
 * Values are requests per second (some providers use burst limits).
 */
const RATE_LIMITS: Record<ChannelProvider, { requestsPerSecond: number; burstLimit?: number }> = {
  etsy: { requestsPerSecond: 10 },
  shopify: { requestsPerSecond: 2, burstLimit: 40 },
  wix: { requestsPerSecond: 50 },
  ebay: { requestsPerSecond: 5 },
};

/**
 * Sliding window data structure.
 * Key: `${provider}:${connectionId}`
 */
const requestWindows = new Map<
  string,
  {
    timestamps: number[];
    burstCount: number;
    burstWindowStart: number;
  }
>();

/**
 * Get the window key for a provider and connection.
 */
function getWindowKey(provider: ChannelProvider, connectionId: string): string {
  return `${provider}:${connectionId}`;
}

/**
 * Clean up old timestamps outside the sliding window (1 second).
 */
function cleanupWindow(window: { timestamps: number[] }): void {
  const cutoff = Date.now() - 1000;
  window.timestamps = window.timestamps.filter((ts) => ts > cutoff);
}

/**
 * Check if a request can be made without exceeding rate limits.
 * Returns the number of milliseconds to wait, or 0 if the request can proceed.
 */
export function checkRateLimit(
  provider: ChannelProvider,
  connectionId: string
): { canProceed: boolean; waitMs: number; currentRate: number; limit: number } {
  const key = getWindowKey(provider, connectionId);
  const limits = RATE_LIMITS[provider];

  if (!requestWindows.has(key)) {
    requestWindows.set(key, {
      timestamps: [],
      burstCount: 0,
      burstWindowStart: Date.now(),
    });
  }

  const window = requestWindows.get(key)!;
  cleanupWindow(window);

  const currentRate = window.timestamps.length;
  const limit = limits.requestsPerSecond;

  if (currentRate >= limit) {
    const oldestTimestamp = window.timestamps[0];
    const waitMs = oldestTimestamp + 1000 - Date.now() + 10;
    return {
      canProceed: false,
      waitMs: Math.max(waitMs, 50),
      currentRate,
      limit,
    };
  }

  if (limits.burstLimit) {
    const burstWindowMs = 60000;
    const now = Date.now();
    if (now - window.burstWindowStart > burstWindowMs) {
      window.burstCount = 0;
      window.burstWindowStart = now;
    }
    if (window.burstCount >= limits.burstLimit) {
      const waitMs = window.burstWindowStart + burstWindowMs - now + 10;
      return {
        canProceed: false,
        waitMs: Math.max(waitMs, 50),
        currentRate,
        limit: limits.burstLimit,
      };
    }
  }

  return { canProceed: true, waitMs: 0, currentRate, limit };
}

/**
 * Record a request being made.
 */
export function recordRequest(provider: ChannelProvider, connectionId: string): void {
  const key = getWindowKey(provider, connectionId);

  if (!requestWindows.has(key)) {
    requestWindows.set(key, {
      timestamps: [],
      burstCount: 0,
      burstWindowStart: Date.now(),
    });
  }

  const window = requestWindows.get(key)!;
  window.timestamps.push(Date.now());

  const limits = RATE_LIMITS[provider];
  if (limits.burstLimit) {
    window.burstCount++;
  }
}

/**
 * Wait until rate limit allows a request, then record the request.
 * Returns immediately if within limits.
 */
export async function waitForRateLimit(
  provider: ChannelProvider,
  connectionId: string
): Promise<void> {
  const check = checkRateLimit(provider, connectionId);
  if (check.canProceed) {
    recordRequest(provider, connectionId);
    return;
  }

  const waitMs = Math.min(check.waitMs, 5000);
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  const recheck = checkRateLimit(provider, connectionId);
  if (!recheck.canProceed) {
    console.warn("[rate-limit] still rate limited after wait", {
      provider,
      connectionId,
      currentRate: recheck.currentRate,
      limit: recheck.limit,
    });
  }
  recordRequest(provider, connectionId);
}

/**
 * Get current rate limit stats for a connection.
 */
export function getRateLimitStats(
  provider: ChannelProvider,
  connectionId: string
): {
  currentRate: number;
  limit: number;
  percentUsed: number;
  burstCount?: number;
  burstLimit?: number;
} {
  const key = getWindowKey(provider, connectionId);
  const limits = RATE_LIMITS[provider];
  const window = requestWindows.get(key);

  if (!window) {
    return {
      currentRate: 0,
      limit: limits.requestsPerSecond,
      percentUsed: 0,
      burstLimit: limits.burstLimit,
      burstCount: 0,
    };
  }

  cleanupWindow(window);
  const currentRate = window.timestamps.length;

  return {
    currentRate,
    limit: limits.requestsPerSecond,
    percentUsed: Math.round((currentRate / limits.requestsPerSecond) * 100),
    burstCount: window.burstCount,
    burstLimit: limits.burstLimit,
  };
}

/**
 * Check if we're approaching the rate limit (>80% used).
 */
export function isApproachingRateLimit(
  provider: ChannelProvider,
  connectionId: string
): boolean {
  const stats = getRateLimitStats(provider, connectionId);
  return stats.percentUsed >= 80;
}

/**
 * Reset rate limit tracking for a connection (e.g., after a long pause).
 */
export function resetRateLimitTracking(
  provider: ChannelProvider,
  connectionId: string
): void {
  const key = getWindowKey(provider, connectionId);
  requestWindows.delete(key);
}

/**
 * Get all connections that are currently rate limited.
 */
export function getRateLimitedConnections(): Array<{
  provider: ChannelProvider;
  connectionId: string;
  currentRate: number;
  limit: number;
}> {
  const limited: Array<{
    provider: ChannelProvider;
    connectionId: string;
    currentRate: number;
    limit: number;
  }> = [];

  for (const [key, window] of requestWindows) {
    const [provider, connectionId] = key.split(":") as [ChannelProvider, string];
    cleanupWindow(window);
    const limits = RATE_LIMITS[provider];
    if (window.timestamps.length >= limits.requestsPerSecond) {
      limited.push({
        provider,
        connectionId,
        currentRate: window.timestamps.length,
        limit: limits.requestsPerSecond,
      });
    }
  }

  return limited;
}
