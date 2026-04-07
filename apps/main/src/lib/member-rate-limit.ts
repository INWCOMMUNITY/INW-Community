/**
 * Per-member sliding-window rate limits (in-memory; best-effort on serverless).
 */
const store = new Map<string, number[]>();

export function checkMemberRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  let timestamps = store.get(key) ?? [];
  timestamps = timestamps.filter((t) => t > cutoff);
  store.set(key, timestamps);

  if (timestamps.length >= maxRequests) {
    const oldest = timestamps[0] ?? now;
    const retryAfterSec = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
  }
  timestamps.push(now);
  return { allowed: true };
}
