/**
 * Simple in-memory rate limiter. Limits requests per key (e.g. IP) per window.
 * Note: In serverless (Vercel), each instance has its own map; provides best-effort protection.
 */
const store = new Map<string, number[]>();
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 5;

export function checkRateLimit(key: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  let timestamps = store.get(key) ?? [];
  timestamps = timestamps.filter((t) => t > cutoff);
  store.set(key, timestamps);

  if (timestamps.length >= MAX_REQUESTS) {
    return { allowed: false, remaining: 0 };
  }
  timestamps.push(now);
  return { allowed: true, remaining: MAX_REQUESTS - timestamps.length };
}

export function getClientIdentifier(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
