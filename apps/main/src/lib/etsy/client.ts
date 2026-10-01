import {
  ETSY_API_BASE_URL,
  ETSY_OAUTH_TOKEN_URL,
  ETSY_REFRESH_TOKEN_TTL_MS,
} from "./constants";
import { etsyApiKeyHeader, type EtsyAppConfig } from "./config";
import {
  classifyEtsyHttpStatus,
  EtsyRequestError,
  isEtsyRetryableErrorClass,
  parseEtsyRetryAfterMs,
  type EtsyErrorClass,
} from "./errors";
import { getEtsyAppRateLimiter } from "./rate-limit";
import { redactEtsySecrets } from "./redact";

export type EtsyFetch = typeof fetch;

export type EtsyTokenBundle = {
  accessToken: string;
  refreshToken: string;
  scope: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  etsyUserId: string;
};

export type EtsyShopIdentity = {
  etsyUserId: string;
  shopId: string;
  shopName: string | null;
};

export type EtsyRefreshResult =
  | { status: "refreshed"; tokens: EtsyTokenBundle }
  | { status: "reauthorize" }
  | { status: "retry" }
  | { status: "failed" };

export type EtsyApiResult<T = unknown> = {
  ok: boolean;
  class: EtsyErrorClass | "SUCCESS";
  httpStatus: number | null;
  data: T | null;
  message: string;
  retryAfterMs: number | null;
  rateLimit: {
    remainingThisSecond: number | null;
    remainingToday: number | null;
  } | null;
};

export type EtsyRequestDeps = {
  config: EtsyAppConfig;
  accessToken: string;
  fetchImpl?: EtsyFetch;
  /** Max attempts including the first. Default 3 for GET; mutations should pass 1. */
  maxAttempts?: number;
  timeoutMs?: number;
  /** Skip process rate limiter (tests / token endpoints). */
  skipRateLimit?: boolean;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 30_000;

function parseUserIdFromAccessToken(accessToken: string): string | null {
  const prefix = accessToken.split(".")[0] ?? "";
  return /^\d+$/.test(prefix) ? prefix : null;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new EtsyRequestError(
      `Etsy returned a non-JSON response (${response.status})`,
      classifyEtsyHttpStatus(response.status),
      response.status
    );
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs != null) return retryAfterMs;
  const base = Math.min(1000 * 2 ** attempt, 8000);
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

/**
 * Authenticated Open API v3 application request with app-level rate limiting.
 * Retries only for THROTTLED / TRANSIENT / NETWORK. Mutations should set maxAttempts=1
 * unless the caller has reconciled for duplicate-safe outcomes.
 */
export async function etsyApplicationRequest<T = unknown>(input: {
  method: string;
  path: string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
  deps: EtsyRequestDeps;
}): Promise<EtsyApiResult<T>> {
  const fetchImpl = input.deps.fetchImpl ?? fetch;
  const sleep = input.deps.sleep ?? defaultSleep;
  const maxAttempts = Math.max(1, input.deps.maxAttempts ?? (input.method.toUpperCase() === "GET" ? 3 : 1));
  const timeoutMs = input.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limiter = getEtsyAppRateLimiter();

  const url = new URL(
    input.path.startsWith("http")
      ? input.path
      : `${ETSY_API_BASE_URL}${input.path.startsWith("/") ? "" : "/"}${input.path}`
  );
  if (input.query) {
    for (const [key, value] of Object.entries(input.query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  let last: EtsyApiResult<T> | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!input.deps.skipRateLimit) {
      await limiter.acquire();
    }

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: input.method,
        headers: {
          Authorization: `Bearer ${input.deps.accessToken}`,
          "x-api-key": etsyApiKeyHeader(input.deps.config),
          Accept: "application/json",
          ...(input.body && !input.headers?.["Content-Type"]
            ? { "Content-Type": "application/json" }
            : {}),
          ...input.headers,
        },
        body: input.body ?? undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? `Etsy request unreachable: ${error.name}`
          : "Etsy request unreachable";
      last = {
        ok: false,
        class: "NETWORK",
        httpStatus: null,
        data: null,
        message: redactEtsySecrets(message),
        retryAfterMs: backoffMs(attempt, null),
        rateLimit: null,
      };
      if (attempt + 1 < maxAttempts) {
        await sleep(last.retryAfterMs ?? 250);
        continue;
      }
      return last;
    }

    limiter.observeHeaders(response.headers);
    const observation = limiter.getLastObservation();
    const rateLimit = observation
      ? {
          remainingThisSecond: observation.remainingThisSecond,
          remainingToday: observation.remainingToday,
        }
      : null;

    if (response.ok) {
      let data: T | null = null;
      try {
        data = (await readJson(response)) as T;
      } catch (error) {
        if (error instanceof EtsyRequestError) {
          return {
            ok: false,
            class: error.errorClass,
            httpStatus: error.httpStatus,
            data: null,
            message: error.message,
            retryAfterMs: null,
            rateLimit,
          };
        }
        throw error;
      }
      return {
        ok: true,
        class: "SUCCESS",
        httpStatus: response.status,
        data,
        message: "ok",
        retryAfterMs: null,
        rateLimit,
      };
    }

    const errorClass = classifyEtsyHttpStatus(response.status);
    const retryAfterMs =
      errorClass === "THROTTLED"
        ? parseEtsyRetryAfterMs(response.headers, backoffMs(attempt, null))
        : isEtsyRetryableErrorClass(errorClass)
          ? backoffMs(attempt, null)
          : null;

    // Drain body without logging secrets.
    try {
      await response.text();
    } catch {
      // ignore
    }

    last = {
      ok: false,
      class: errorClass,
      httpStatus: response.status,
      data: null,
      message: redactEtsySecrets(`Etsy API ${response.status}`),
      retryAfterMs,
      rateLimit,
    };

    if (!isEtsyRetryableErrorClass(errorClass) || attempt + 1 >= maxAttempts) {
      return last;
    }
    await sleep(retryAfterMs ?? 250);
  }

  return (
    last ?? {
      ok: false,
      class: "NETWORK",
      httpStatus: null,
      data: null,
      message: "Etsy request failed",
      retryAfterMs: null,
      rateLimit: null,
    }
  );
}

async function parseTokenResponse(
  response: Response,
  now: Date
): Promise<EtsyTokenBundle> {
  if (!response.ok) {
    throw new EtsyRequestError(
      `Etsy token exchange failed (${response.status})`,
      classifyEtsyHttpStatus(response.status),
      response.status
    );
  }
  const body = (await readJson(response)) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  } | null;
  const accessToken = typeof body?.access_token === "string" ? body.access_token : "";
  const refreshToken = typeof body?.refresh_token === "string" ? body.refresh_token : "";
  const expiresIn =
    typeof body?.expires_in === "number" && Number.isFinite(body.expires_in)
      ? body.expires_in
      : 3600;
  const scope = typeof body?.scope === "string" ? body.scope : "";
  const etsyUserId = parseUserIdFromAccessToken(accessToken);
  if (!accessToken || !refreshToken || !etsyUserId) {
    throw new EtsyRequestError("Etsy token response was malformed", "PERMANENT", response.status);
  }
  return {
    accessToken,
    refreshToken,
    scope,
    etsyUserId,
    accessTokenExpiresAt: new Date(now.getTime() + expiresIn * 1000),
    refreshTokenExpiresAt: new Date(now.getTime() + ETSY_REFRESH_TOKEN_TTL_MS),
  };
}

export async function exchangeEtsyAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  config: EtsyAppConfig;
  fetchImpl?: EtsyFetch;
  now?: Date;
}): Promise<EtsyTokenBundle> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? new Date();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.config.clientId,
    redirect_uri: input.config.redirectUri,
    code: input.code,
    code_verifier: input.codeVerifier,
  });
  let response: Response;
  try {
    response = await fetchImpl(ETSY_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new EtsyRequestError(
      error instanceof Error
        ? `Etsy token exchange unreachable: ${error.name}`
        : "Etsy token exchange unreachable",
      "NETWORK"
    );
  }
  return parseTokenResponse(response, now);
}

export async function refreshEtsyAccessToken(input: {
  refreshToken: string;
  config: EtsyAppConfig;
  fetchImpl?: EtsyFetch;
  now?: Date;
}): Promise<EtsyRefreshResult> {
  if (!input.refreshToken) return { status: "reauthorize" };
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? new Date();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.config.clientId,
    refresh_token: input.refreshToken,
  });
  let response: Response;
  try {
    response = await fetchImpl(ETSY_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch {
    return { status: "retry" };
  }
  if (response.status === 401 || response.status === 403) return { status: "reauthorize" };
  if (response.status === 429 || response.status >= 500) return { status: "retry" };
  if (!response.ok) return { status: "failed" };
  try {
    const tokens = await parseTokenResponse(response, now);
    return { status: "refreshed", tokens };
  } catch {
    return { status: "failed" };
  }
}

/**
 * Resolve the seller's Etsy shop for the authorized user.
 * GET /v3/application/users/{user_id}/shops
 */
export async function fetchEtsyShopForUser(input: {
  etsyUserId: string;
  accessToken: string;
  config: EtsyAppConfig;
  fetchImpl?: EtsyFetch;
  sleep?: (ms: number) => Promise<void>;
}): Promise<EtsyShopIdentity> {
  const result = await etsyApplicationRequest<{
    shop_id?: unknown;
    shop_name?: unknown;
    results?: Array<{ shop_id?: unknown; shop_name?: unknown }>;
  }>({
    method: "GET",
    path: `/users/${encodeURIComponent(input.etsyUserId)}/shops`,
    deps: {
      config: input.config,
      accessToken: input.accessToken,
      fetchImpl: input.fetchImpl,
      maxAttempts: 3,
      sleep: input.sleep,
    },
  });

  if (!result.ok || !result.data) {
    throw new EtsyRequestError(
      result.message || "Etsy shop identity could not be verified",
      result.class === "SUCCESS" ? "PERMANENT" : result.class,
      result.httpStatus,
      result.retryAfterMs
    );
  }

  const body = result.data;
  const shop =
    body.shop_id != null
      ? body
      : Array.isArray(body.results) && body.results.length > 0
        ? body.results[0]
        : null;
  if (!shop) {
    throw new EtsyRequestError("Etsy shop was missing from identity response", "PERMANENT");
  }

  const shopIdRaw = shop.shop_id;
  const shopId =
    typeof shopIdRaw === "number"
      ? String(shopIdRaw)
      : typeof shopIdRaw === "string"
        ? shopIdRaw.trim()
        : "";
  if (!shopId || !/^\d+$/.test(shopId)) {
    throw new EtsyRequestError("Etsy shop id was invalid", "PERMANENT");
  }

  const shopName =
    typeof shop.shop_name === "string" && shop.shop_name.trim()
      ? shop.shop_name.trim()
      : null;

  return {
    etsyUserId: input.etsyUserId,
    shopId,
    shopName,
  };
}
