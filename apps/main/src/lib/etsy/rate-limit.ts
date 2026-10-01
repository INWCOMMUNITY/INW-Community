/**
 * Process-wide Etsy application rate limiter.
 * Etsy enforces QPS/QPD at the API-key level across all seller connections.
 */

export type EtsyRateLimitSnapshot = {
  limitPerSecond: number | null;
  remainingThisSecond: number | null;
  limitPerDay: number | null;
  remainingToday: number | null;
  observedAt: number;
};

export type EtsyRateLimiterOptions = {
  /** Local QPS ceiling. Keep at or below Etsy's app allowance. Default 5 (safe for new apps). */
  qps?: number;
  /** Optional clock for tests. */
  now?: () => number;
  /** Optional sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_QPS = 5;

function readConfiguredQps(): number {
  const raw = process.env.ETSY_RATE_LIMIT_QPS?.trim();
  if (!raw) return DEFAULT_QPS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_QPS;
  return Math.min(Math.floor(n), 150);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class EtsyAppRateLimiter {
  private readonly timestamps: number[] = [];
  private qps: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private chain: Promise<void> = Promise.resolve();
  private lastObservation: EtsyRateLimitSnapshot | null = null;

  constructor(options: EtsyRateLimiterOptions = {}) {
    this.qps = options.qps ?? readConfiguredQps();
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  getQps(): number {
    return this.qps;
  }

  setQps(qps: number): void {
    if (!Number.isFinite(qps) || qps < 1) return;
    this.qps = Math.min(Math.floor(qps), 150);
  }

  getLastObservation(): EtsyRateLimitSnapshot | null {
    return this.lastObservation;
  }

  /**
   * Observe Etsy response headers and optionally tighten local QPS to match
   * the provider's advertised per-second limit.
   */
  observeHeaders(headers: Headers): void {
    const limitPerSecond = parseHeaderInt(headers.get("x-limit-per-second"));
    const remainingThisSecond = parseHeaderInt(headers.get("x-remaining-this-second"));
    // Etsy docs historically truncates header name; accept both spellings.
    const remainingAlt = parseHeaderInt(headers.get("x-remaining-this-secon"));
    const limitPerDay = parseHeaderInt(headers.get("x-limit-per-day"));
    const remainingToday = parseHeaderInt(headers.get("x-remaining-today"));

    this.lastObservation = {
      limitPerSecond,
      remainingThisSecond: remainingThisSecond ?? remainingAlt,
      limitPerDay,
      remainingToday,
      observedAt: this.now(),
    };

    if (limitPerSecond != null && limitPerSecond > 0) {
      // Never raise above configured ceiling automatically; only tighten.
      this.qps = Math.min(this.qps, limitPerSecond);
    }
  }

  /** Serialize acquires so concurrent callers share one QPS budget. */
  acquire(): Promise<void> {
    const run = this.chain.then(() => this.waitForSlot());
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = this.now();
      this.prune(now);
      if (this.timestamps.length < this.qps) {
        this.timestamps.push(now);
        return;
      }
      const oldest = this.timestamps[0] ?? now;
      const waitMs = Math.max(1, 1000 - (now - oldest));
      await this.sleep(waitMs);
    }
  }

  private prune(now: number): void {
    while (this.timestamps.length > 0 && now - (this.timestamps[0] ?? 0) >= 1000) {
      this.timestamps.shift();
    }
  }
}

function parseHeaderInt(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

let singleton: EtsyAppRateLimiter | null = null;

export function getEtsyAppRateLimiter(): EtsyAppRateLimiter {
  if (!singleton) singleton = new EtsyAppRateLimiter();
  return singleton;
}

/** Test helper — replaces the process singleton. */
export function resetEtsyAppRateLimiterForTests(limiter?: EtsyAppRateLimiter | null): void {
  singleton = limiter ?? null;
}
