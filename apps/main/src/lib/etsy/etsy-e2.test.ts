import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EtsyAppRateLimiter,
  getEtsyAppRateLimiter,
  resetEtsyAppRateLimiterForTests,
} from "./rate-limit";
import {
  classifyEtsyApiError,
  classifyEtsyHttpStatus,
  isEtsyListingBusyConflict,
  isEtsyRetryableErrorClass,
  parseEtsyRetryAfterMs,
} from "./errors";
import { redactEtsySecrets } from "./redact";
import { getEtsyAdapterCapabilities } from "./capabilities";
import {
  etsyApplicationRequest,
  refreshEtsyAccessToken,
} from "./client";
import {
  accessTokenForEtsyConnection,
  clearEtsyRefreshInFlightForTests,
} from "./connect";

vi.mock("database", () => ({
  prisma: {
    etsyConnection: {
      findFirst: vi.fn(),
    },
  },
  rotateEtsyTokenMaterial: vi.fn(),
  createEtsyOAuthState: vi.fn(),
  consumeEtsyOAuthState: vi.fn(),
  readEtsyOAuthBrowserBindingHash: vi.fn(),
  persistEtsyInstall: vi.fn(),
}));

vi.mock("@/lib/encrypt", () => ({
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
}));

import { prisma, rotateEtsyTokenMaterial } from "database";

const config = {
  apiKey: "etsy-keystring",
  clientSecret: "etsy-shared-secret",
  clientId: "etsy-keystring",
  appUrl: "https://app.example.com",
  redirectUri: "https://app.example.com/api/etsy/oauth/callback",
  providerEvidenceWebhookUri: "https://app.example.com/api/etsy/webhooks/inbox",
  scopes: ["listings_r", "listings_w", "shops_r", "transactions_r"] as const,
};

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("etsy rate limiter", () => {
  it("serializes acquires under the QPS ceiling", async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const limiter = new EtsyAppRateLimiter({
      qps: 2,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });

    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);
    expect(sleeps.length).toBeGreaterThanOrEqual(1);
    expect(limiter.getQps()).toBe(2);
  });

  it("tightens QPS from provider headers but does not raise it", () => {
    const limiter = new EtsyAppRateLimiter({ qps: 8 });
    limiter.observeHeaders(
      new Headers({
        "x-limit-per-second": "5",
        "x-remaining-this-second": "4",
        "x-limit-per-day": "10000",
        "x-remaining-today": "9999",
      })
    );
    expect(limiter.getQps()).toBe(5);
    limiter.observeHeaders(new Headers({ "x-limit-per-second": "150" }));
    expect(limiter.getQps()).toBe(5);
  });
});

describe("etsy error classification", () => {
  it("treats 429 as throttled/retryable and 4xx as permanent", () => {
    expect(classifyEtsyHttpStatus(429)).toBe("THROTTLED");
    expect(classifyEtsyHttpStatus(500)).toBe("TRANSIENT");
    expect(classifyEtsyHttpStatus(409)).toBe("TRANSIENT");
    expect(classifyEtsyHttpStatus(400)).toBe("PERMANENT");
    expect(isEtsyRetryableErrorClass("THROTTLED")).toBe(true);
    expect(isEtsyRetryableErrorClass("PERMANENT")).toBe(false);
  });

  it("treats listing-busy 409 copy as transient contention", () => {
    const msg =
      "Etsy API 409: the listing with listing id 4586604968 is being edited by another process. please try again in a few moment";
    expect(isEtsyListingBusyConflict(msg)).toBe(true);
    expect(classifyEtsyApiError(409, msg)).toBe("TRANSIENT");
    expect(classifyEtsyApiError(400, msg)).toBe("TRANSIENT");
  });

  it("parses retry-after seconds", () => {
    expect(parseEtsyRetryAfterMs(new Headers({ "retry-after": "2" }), 100)).toBe(2000);
  });
});

describe("etsy redact", () => {
  it("strips token-shaped secrets", () => {
    expect(redactEtsySecrets("token 12345678.O1zLuwveeKjpIqCQFfmR-PaMMpBmagH6Dlj")).toContain(
      "[redacted]"
    );
  });
});

describe("etsy capabilities", () => {
  it("documents inventory full-replace and three-axis rules", () => {
    const caps = getEtsyAdapterCapabilities();
    expect(caps.inventoryUpdateIsFullReplace).toBe(true);
    expect(caps.maxVariationAxes).toBe(3);
    expect(caps.onPropertyMustBeZeroOneOrAll).toBe(true);
    expect(caps.supportsProductWebhooks).toBe(false);
  });
});

describe("etsyApplicationRequest", () => {
  beforeEach(() => {
    resetEtsyAppRateLimiterForTests(
      new EtsyAppRateLimiter({
        qps: 50,
        sleep: async () => undefined,
      })
    );
  });

  it("retries GET on 429 then succeeds", async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: "rate" }, 429, { "retry-after": "0" })
      )
      .mockResolvedValueOnce(jsonResponse({ shop_id: 1 }));

    const result = await etsyApplicationRequest({
      method: "GET",
      path: "/users/1/shops",
      deps: {
        config,
        accessToken: "12345678.access_token_value_here_ok",
        fetchImpl,
        maxAttempts: 3,
        skipRateLimit: true,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps.length).toBe(1);
  });

  it("does not retry permanent 400 on mutations", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "bad" }, 400));
    const result = await etsyApplicationRequest({
      method: "PUT",
      path: "/listings/1/inventory",
      body: "{}",
      deps: {
        config,
        accessToken: "12345678.access_token_value_here_ok",
        fetchImpl,
        skipRateLimit: true,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.class).toBe("PERMANENT");
    expect(result.message).toBe("Etsy API 400: bad");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("refreshEtsyAccessToken classification", () => {
  it("maps 429 to retry and 401 to reauthorize", async () => {
    await expect(
      refreshEtsyAccessToken({
        refreshToken: "12345678.refresh_token_value_here_ok",
        config,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse({}, 429)),
      })
    ).resolves.toEqual({ status: "retry" });

    await expect(
      refreshEtsyAccessToken({
        refreshToken: "12345678.refresh_token_value_here_ok",
        config,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse({}, 401)),
      })
    ).resolves.toEqual({ status: "reauthorize" });
  });
});

describe("accessTokenForEtsyConnection single-flight", () => {
  beforeEach(() => {
    clearEtsyRefreshInFlightForTests();
    vi.mocked(prisma.etsyConnection.findFirst).mockReset();
    vi.mocked(rotateEtsyTokenMaterial).mockReset();
    process.env.ENCRYPTION_KEY = "test-encryption-key-value";
  });

  it("coalesces concurrent refresh callers into one token exchange", async () => {
    let resolveFetch: ((value: Response) => void) | null = null;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchImpl = vi.fn().mockReturnValue(fetchPromise);

    const expired = new Date("2020-01-01T00:00:00Z");
    const future = new Date("2099-01-01T00:00:00Z");
    const connection = {
      id: "conn-1",
      memberId: "member-a",
      accessTokenEncrypted: "enc:12345678.old_access_token_value_xx",
      refreshTokenEncrypted: "enc:12345678.old_refresh_token_value_x",
      accessTokenExpiresAt: expired,
      refreshTokenExpiresAt: future,
    };

    vi.mocked(prisma.etsyConnection.findFirst).mockResolvedValue({
      ...connection,
      etsyUserId: "12345678",
      shopId: "9",
      shopName: "Demo",
      generation: 1,
      grantedScopes: "listings_r",
      status: "ACTIVE",
      connectedAt: new Date(),
      disconnectedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(rotateEtsyTokenMaterial).mockResolvedValue(true);

    const p1 = accessTokenForEtsyConnection(connection, { config, fetchImpl });
    const p2 = accessTokenForEtsyConnection(connection, { config, fetchImpl });

    resolveFetch?.(
      jsonResponse({
        access_token: "12345678.new_access_token_value_xxx",
        refresh_token: "12345678.new_refresh_token_value_xx",
        expires_in: 3600,
        scope: "listings_r listings_w shops_r transactions_r",
      })
    );

    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1).toBe("12345678.new_access_token_value_xxx");
    expect(t2).toBe(t1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(rotateEtsyTokenMaterial).toHaveBeenCalledTimes(1);
  });
});

describe("rate limiter singleton reset", () => {
  it("exposes getEtsyAppRateLimiter", () => {
    resetEtsyAppRateLimiterForTests(null);
    expect(getEtsyAppRateLimiter().getQps()).toBeGreaterThanOrEqual(1);
  });
});
