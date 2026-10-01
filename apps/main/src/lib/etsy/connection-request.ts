import { prisma } from "database";
import { etsyApplicationRequest, type EtsyApiResult, type EtsyFetch } from "./client";
import { readEtsyAppConfig } from "./config";
import { accessTokenForEtsyConnection, EtsyConnectError } from "./connect";
import type { EtsyErrorClass } from "./errors";

export type EtsyBodyEncoding = "json" | "form" | "multipart";

export type EtsyConnectionRequestInput = {
  connectionId: string;
  memberId: string;
  method: string;
  path: string;
  body?: unknown;
  /** Default json. Etsy createListing/activate expect form-urlencoded. Use multipart for image upload. */
  bodyEncoding?: EtsyBodyEncoding;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Default: GET retries 3x; non-GET 1x. */
  maxAttempts?: number;
  timeoutMs?: number;
  fetchImpl?: EtsyFetch;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
};

function encodeFormBody(body: unknown): string {
  const params = new URLSearchParams();
  if (!body || typeof body !== "object" || Array.isArray(body)) return params.toString();
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
      params.set(key, String(value));
    } else {
      params.set(key, JSON.stringify(value));
    }
  }
  return params.toString();
}

/**
 * Resolve an ACTIVE Etsy connection for the member, refresh token if needed,
 * then perform a rate-limited application API call.
 */
export async function etsyConnectionRequest<T = unknown>(
  input: EtsyConnectionRequestInput
): Promise<EtsyApiResult<T>> {
  const config = readEtsyAppConfig();
  if (!config) {
    return {
      ok: false,
      class: "NOT_CONFIGURED",
      httpStatus: null,
      data: null,
      message: "Etsy is not configured",
      retryAfterMs: null,
      rateLimit: null,
    };
  }

  const connection = await prisma.etsyConnection.findFirst({
    where: {
      id: input.connectionId,
      memberId: input.memberId,
      status: "ACTIVE",
    },
  });
  if (!connection) {
    return {
      ok: false,
      class: "CONNECTION_INACTIVE",
      httpStatus: null,
      data: null,
      message: "Etsy connection was not found or is inactive",
      retryAfterMs: null,
      rateLimit: null,
    };
  }

  let accessToken: string;
  try {
    accessToken = await accessTokenForEtsyConnection(connection, {
      config,
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
  } catch (error) {
    const authClass: EtsyErrorClass =
      error instanceof EtsyConnectError && error.code === "not_configured"
        ? "NOT_CONFIGURED"
        : "AUTH";
    return {
      ok: false,
      class: authClass,
      httpStatus: null,
      data: null,
      message:
        error instanceof EtsyConnectError
          ? error.message
          : "Etsy authorization is required",
      retryAfterMs: null,
      rateLimit: null,
    };
  }

  const encoding = input.bodyEncoding ?? "json";
  let body: BodyInit | null = null;
  let headers: Record<string, string> | undefined;
  if (input.body !== undefined) {
    if (encoding === "multipart") {
      if (!(typeof FormData !== "undefined" && input.body instanceof FormData)) {
        return {
          ok: false,
          class: "PERMANENT",
          httpStatus: null,
          data: null,
          message: "Etsy multipart request requires FormData body",
          retryAfterMs: null,
          rateLimit: null,
        };
      }
      // Let fetch set multipart boundary Content-Type.
      body = input.body;
      headers = undefined;
    } else if (encoding === "form") {
      body = encodeFormBody(input.body);
      headers = { "Content-Type": "application/x-www-form-urlencoded" };
    } else {
      body = JSON.stringify(input.body);
      headers = { "Content-Type": "application/json" };
    }
  }

  return etsyApplicationRequest<T>({
    method: input.method,
    path: input.path,
    body,
    headers,
    query: input.query,
    deps: {
      config,
      accessToken,
      fetchImpl: input.fetchImpl,
      maxAttempts: input.maxAttempts,
      timeoutMs: input.timeoutMs,
      sleep: input.sleep,
    },
  });
}
