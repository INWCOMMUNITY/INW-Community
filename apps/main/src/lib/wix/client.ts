import {
  WIX_API_BASE_URL,
  WIX_OAUTH_TOKEN_URL,
  WIX_REQUEST_TIMEOUT_MS,
  WIX_TOKEN_MINT_TIMEOUT_MS,
  WIX_CATALOG_VERSION_URL,
  WIX_MAX_RETRY_ATTEMPTS,
  WIX_RETRY_BASE_DELAY_MS,
  WIX_RETRY_MAX_DELAY_MS,
} from "./constants";
import type { WixAppConfig } from "./config";
import type { WixCatalogVersion } from "database";

export type WixFetch = typeof fetch;

export type WixErrorClass =
  | "SUCCESS"
  | "THROTTLED"
  | "TRANSIENT"
  | "NETWORK"
  | "AUTH"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CATALOG_VERSION_MISMATCH"
  | "PERMANENT";

export type WixApiResult<T = unknown> = {
  ok: boolean;
  class: WixErrorClass;
  httpStatus: number | null;
  data: T | null;
  message: string;
  retryAfterMs: number | null;
};

export class WixRequestError extends Error {
  constructor(
    message: string,
    readonly errorClass: WixErrorClass,
    readonly httpStatus?: number | null,
    readonly retryAfterMs?: number | null
  ) {
    super(message);
    this.name = "WixRequestError";
  }
}

export type WixRequestDeps = {
  config: WixAppConfig;
  accessToken: string;
  fetchImpl?: WixFetch;
  maxAttempts?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  const base = Math.min(WIX_RETRY_BASE_DELAY_MS * 2 ** attempt, WIX_RETRY_MAX_DELAY_MS);
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

function classifyWixHttpStatus(status: number): WixErrorClass {
  if (status >= 200 && status < 300) return "SUCCESS";
  if (status === 401 || status === 403) return "AUTH";
  if (status === 404) return "NOT_FOUND";
  if (status === 428) return "CATALOG_VERSION_MISMATCH";
  if (status === 429) return "THROTTLED";
  if (status === 400 || status === 422) return "VALIDATION";
  if (status >= 500) return "TRANSIENT";
  return "PERMANENT";
}

function isRetryableErrorClass(errorClass: WixErrorClass): boolean {
  return errorClass === "THROTTLED" || errorClass === "TRANSIENT" || errorClass === "NETWORK";
}

function parseRetryAfter(headers: Headers): number | null {
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) return null;
  const seconds = parseInt(retryAfter, 10);
  if (Number.isNaN(seconds)) return null;
  return seconds * 1000;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new WixRequestError(
      `Wix returned a non-JSON response (${response.status})`,
      classifyWixHttpStatus(response.status),
      response.status
    );
  }
}

function extractWixErrorMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const obj = body as Record<string, unknown>;
  if (typeof obj.message === "string") return obj.message;
  if (obj.details && typeof obj.details === "object") {
    const details = obj.details as Record<string, unknown>;
    if (typeof details.validationError === "string") return details.validationError;
  }
  return "";
}

/**
 * Mint a Wix access token using app credentials and instance ID.
 * Wix uses app-instance authentication, not per-seller refresh tokens.
 */
export async function mintWixAccessToken(input: {
  appId: string;
  appSecret: string;
  instanceId: string;
  fetchImpl?: WixFetch;
}): Promise<{ accessToken: string }> {
  const fetchImpl = input.fetchImpl ?? fetch;

  const body = JSON.stringify({
    grant_type: "client_credentials",
    client_id: input.appId,
    client_secret: input.appSecret,
    instance_id: input.instanceId,
  });

  let response: Response;
  try {
    response = await fetchImpl(WIX_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(WIX_TOKEN_MINT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new WixRequestError(
      error instanceof Error
        ? `Wix token mint unreachable: ${error.name}`
        : "Wix token mint unreachable",
      "NETWORK"
    );
  }

  if (!response.ok) {
    throw new WixRequestError(
      `Wix token mint failed (${response.status})`,
      classifyWixHttpStatus(response.status),
      response.status
    );
  }

  const data = (await readJson(response)) as { access_token?: string } | null;
  if (!data?.access_token) {
    throw new WixRequestError("Wix token response was malformed", "PERMANENT", response.status);
  }

  return { accessToken: data.access_token };
}

/**
 * Authenticated Wix API request with retry logic.
 */
export async function wixApplicationRequest<T = unknown>(input: {
  method: string;
  path: string;
  body?: string | null;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
  deps: WixRequestDeps;
}): Promise<WixApiResult<T>> {
  const fetchImpl = input.deps.fetchImpl ?? fetch;
  const sleep = input.deps.sleep ?? defaultSleep;
  const maxAttempts = Math.max(1, input.deps.maxAttempts ?? (input.method.toUpperCase() === "GET" ? WIX_MAX_RETRY_ATTEMPTS : 1));
  const timeoutMs = input.deps.timeoutMs ?? WIX_REQUEST_TIMEOUT_MS;

  const url = new URL(
    input.path.startsWith("http")
      ? input.path
      : `${WIX_API_BASE_URL}${input.path.startsWith("/") ? "" : "/"}${input.path}`
  );
  if (input.query) {
    for (const [key, value] of Object.entries(input.query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  let last: WixApiResult<T> | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: input.method,
        headers: {
          Authorization: input.deps.accessToken,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...input.headers,
        },
        body: input.body ?? undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? `Wix request unreachable: ${error.name}`
          : "Wix request unreachable";
      last = {
        ok: false,
        class: "NETWORK",
        httpStatus: null,
        data: null,
        message,
        retryAfterMs: backoffMs(attempt),
      };
      if (attempt + 1 < maxAttempts) {
        await sleep(last.retryAfterMs ?? 250);
        continue;
      }
      return last;
    }

    if (response.ok) {
      let data: T | null = null;
      try {
        data = (await readJson(response)) as T;
      } catch (error) {
        if (error instanceof WixRequestError) {
          return {
            ok: false,
            class: error.errorClass,
            httpStatus: error.httpStatus ?? null,
            data: null,
            message: error.message,
            retryAfterMs: null,
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
      };
    }

    let bodyText = "";
    let bodyJson: unknown = null;
    try {
      bodyText = await response.text();
      bodyJson = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      // ignore
    }

    const errorMessage = extractWixErrorMessage(bodyJson) || bodyText.slice(0, 200) || `HTTP ${response.status}`;
    const errorClass = classifyWixHttpStatus(response.status);
    const retryAfterMs = isRetryableErrorClass(errorClass)
      ? parseRetryAfter(response.headers) ?? backoffMs(attempt)
      : null;

    last = {
      ok: false,
      class: errorClass,
      httpStatus: response.status,
      data: null,
      message: errorMessage,
      retryAfterMs,
    };

    if (!isRetryableErrorClass(errorClass) || attempt + 1 >= maxAttempts) {
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
      message: "Wix request failed",
      retryAfterMs: null,
    }
  );
}

/**
 * Detect the catalog version (V1 or V3) for a Wix site.
 */
export async function detectWixCatalogVersion(input: {
  accessToken: string;
  config: WixAppConfig;
  fetchImpl?: WixFetch;
}): Promise<WixCatalogVersion> {
  const result = await wixApplicationRequest<{ version?: string }>({
    method: "GET",
    path: WIX_CATALOG_VERSION_URL,
    deps: {
      config: input.config,
      accessToken: input.accessToken,
      fetchImpl: input.fetchImpl,
      maxAttempts: 2,
    },
  });

  if (!result.ok || !result.data) {
    throw new WixRequestError(
      result.message || "Wix catalog version could not be determined",
      result.class === "SUCCESS" ? "TRANSIENT" : result.class,
      result.httpStatus,
      result.retryAfterMs
    );
  }

  const version = result.data.version?.toUpperCase();
  if (version === "V1_CATALOG" || version === "V1") {
    return "V1_CATALOG";
  }
  if (version === "V3_CATALOG" || version === "V3") {
    return "V3_CATALOG";
  }
  throw new WixRequestError(
    "Wix catalog version was not recognized",
    "TRANSIENT",
    result.httpStatus
  );
}

/**
 * Fetch Wix site info using the Instance API.
 */
export async function fetchWixSiteInfo(input: {
  accessToken: string;
  config: WixAppConfig;
  fetchImpl?: WixFetch;
}): Promise<{ siteId: string; instanceId: string; siteName: string | null }> {
  const result = await wixApplicationRequest<{
    instance?: {
      instanceId?: string;
      siteUrl?: string;
    };
    site?: {
      siteId?: string;
      siteDisplayName?: string;
    };
  }>({
    method: "GET",
    path: "/apps/v1/instance",
    deps: {
      config: input.config,
      accessToken: input.accessToken,
      fetchImpl: input.fetchImpl,
      maxAttempts: 2,
    },
  });

  if (!result.ok || !result.data) {
    throw new WixRequestError(
      result.message || "Failed to fetch Wix site info",
      result.class === "SUCCESS" ? "PERMANENT" : result.class,
      result.httpStatus
    );
  }

  const data = result.data;
  const instanceId = data.instance?.instanceId;
  const siteId = data.site?.siteId;
  const siteName = data.site?.siteDisplayName || null;

  if (!instanceId || !siteId) {
    throw new WixRequestError("Wix site info was incomplete", "PERMANENT");
  }

  return { siteId, instanceId, siteName };
}
