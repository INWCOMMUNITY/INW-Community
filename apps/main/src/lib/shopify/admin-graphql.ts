import { prisma } from "database";
import type { ShopifySyncJobClaim, ShopifyJobHandlerResult } from "database";
import {
  claimNextShopifySyncJob,
  completeShopifySyncJobDead,
  completeShopifySyncJobRetry,
  completeShopifySyncJobSuccess,
} from "database";
import { randomUUID } from "crypto";
import { accessTokenForConnection, ShopifyConnectError } from "./connect";
import { SHOPIFY_ADMIN_API_VERSION } from "./constants";
import { handleShopifyCreateListingJob } from "./create-listing";
import { handleShopifyUpdateListingContentJob } from "./update-listing-content";
import { handleShopifyProcessProviderEvidenceJob } from "./process-products-update";
import { handleShopifyProjectInventoryJob } from "./project-inventory";
import { redactShopifySecrets } from "./redact";

export type ShopifyFetch = typeof fetch;

export type ShopifyGraphqlOperationType = "query" | "mutation";

export type ShopifyThrottleStatus = {
  maximumAvailable: number | null;
  currentlyAvailable: number | null;
  restoreRate: number | null;
};

export type ShopifyGraphqlCost = {
  requestedQueryCost: number | null;
  actualQueryCost: number | null;
  throttleStatus: ShopifyThrottleStatus | null;
};

export type ShopifyGraphqlErrorClass =
  | "SUCCESS"
  | "AUTH"
  | "CONNECTION_INACTIVE"
  | "THROTTLED"
  | "TRANSIENT_PROVIDER"
  | "NETWORK_UNKNOWN"
  | "GRAPHQL_PERMANENT";

export type ShopifyGraphqlResult<TData = unknown> = {
  ok: boolean;
  class: ShopifyGraphqlErrorClass;
  httpStatus: number | null;
  requestId: string | null;
  data: TData | null;
  errors: unknown[] | null;
  cost: ShopifyGraphqlCost | null;
  /** True when a mutation request may have reached Shopify with unknown outcome. */
  outcomeUnknown: boolean;
  message: string;
};

export type ShopifyAdminGraphqlInput = {
  connectionId: string;
  operationName?: string;
  document: string;
  variables?: Record<string, unknown>;
  operationType: ShopifyGraphqlOperationType;
  fetchImpl?: ShopifyFetch;
  timeoutMs?: number;
  now?: Date;
};

const DEFAULT_TIMEOUT_MS = 30_000;

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCost(extensions: unknown): ShopifyGraphqlCost | null {
  if (!extensions || typeof extensions !== "object") return null;
  const cost = (extensions as { cost?: unknown }).cost;
  if (!cost || typeof cost !== "object") return null;
  const c = cost as {
    requestedQueryCost?: unknown;
    actualQueryCost?: unknown;
    throttleStatus?: {
      maximumAvailable?: unknown;
      currentlyAvailable?: unknown;
      restoreRate?: unknown;
    };
  };
  const throttle = c.throttleStatus
    ? {
        maximumAvailable: asNumber(c.throttleStatus.maximumAvailable),
        currentlyAvailable: asNumber(c.throttleStatus.currentlyAvailable),
        restoreRate: asNumber(c.throttleStatus.restoreRate),
      }
    : null;
  return {
    requestedQueryCost: asNumber(c.requestedQueryCost),
    actualQueryCost: asNumber(c.actualQueryCost),
    throttleStatus: throttle,
  };
}

function graphqlErrorCodes(errors: unknown): string[] {
  if (!Array.isArray(errors)) return [];
  const codes: string[] = [];
  for (const error of errors) {
    if (!error || typeof error !== "object") continue;
    const extensions = (error as { extensions?: { code?: unknown } }).extensions;
    if (typeof extensions?.code === "string") codes.push(extensions.code.toUpperCase());
  }
  return codes;
}

function classifyGraphqlErrors(
  httpStatus: number,
  errors: unknown[],
  cost: ShopifyGraphqlCost | null
): ShopifyGraphqlErrorClass {
  const codes = graphqlErrorCodes(errors);
  if (
    codes.some((code) =>
      ["THROTTLED", "MAX_COST_EXCEEDED", "TOO_MANY_REQUESTS"].includes(code)
    ) ||
    httpStatus === 429 ||
    (cost?.throttleStatus?.currentlyAvailable !== null &&
      cost?.throttleStatus?.currentlyAvailable !== undefined &&
      cost.throttleStatus.currentlyAvailable <= 0 &&
      errors.length > 0)
  ) {
    return "THROTTLED";
  }
  if (
    codes.some((code) =>
      ["UNAUTHORIZED", "ACCESS_DENIED", "FORBIDDEN", "AUTH_FAILED"].includes(code)
    ) ||
    httpStatus === 401 ||
    httpStatus === 403
  ) {
    return "AUTH";
  }
  if (httpStatus >= 500) return "TRANSIENT_PROVIDER";
  if (codes.some((code) => ["INTERNAL_SERVER_ERROR", "TIMEOUT", "SERVICE_UNAVAILABLE"].includes(code))) {
    return "TRANSIENT_PROVIDER";
  }
  return "GRAPHQL_PERMANENT";
}

function safeMessage(value: string): string {
  return redactShopifySecrets(value);
}

/**
 * Narrow Admin GraphQL client. Resolves shop host + token from an ACTIVE connection.
 * Never accepts caller host/token. Does not automatically retry mutations.
 */
export async function executeShopifyAdminGraphql<TData = unknown>(
  input: ShopifyAdminGraphqlInput
): Promise<ShopifyGraphqlResult<TData>> {
  const connection = await prisma.shopifyConnection.findUnique({
    where: { id: input.connectionId },
  });
  if (!connection) {
    return {
      ok: false,
      class: "CONNECTION_INACTIVE",
      httpStatus: null,
      requestId: null,
      data: null,
      errors: null,
      cost: null,
      outcomeUnknown: false,
      message: "Shopify connection was not found",
    };
  }
  if (connection.status !== "ACTIVE") {
    return {
      ok: false,
      class: "CONNECTION_INACTIVE",
      httpStatus: null,
      requestId: null,
      data: null,
      errors: null,
      cost: null,
      outcomeUnknown: false,
      message: "Shopify connection is not active",
    };
  }

  let accessToken: string;
  try {
    accessToken = await accessTokenForConnection(connection, {
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
  } catch (error) {
    if (error instanceof ShopifyConnectError) {
      return {
        ok: false,
        class: "AUTH",
        httpStatus: null,
        requestId: null,
        data: null,
        errors: null,
        cost: null,
        outcomeUnknown: false,
        message: safeMessage(error.message),
      };
    }
    throw error;
  }

  const endpoint = `https://${connection.shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: input.document,
        variables: input.variables ?? {},
        operationName: input.operationName,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    return {
      ok: false,
      class: "NETWORK_UNKNOWN",
      httpStatus: null,
      requestId: null,
      data: null,
      errors: null,
      cost: null,
      outcomeUnknown: input.operationType === "mutation",
      message: safeMessage(
        input.operationType === "mutation"
          ? `Shopify GraphQL mutation transport failed (${name}); provider outcome unknown`
          : `Shopify GraphQL query transport failed (${name})`
      ),
    };
  }

  const requestId = response.headers.get("x-request-id") ?? response.headers.get("x-shopify-request-id");
  type GraphqlBody = { data?: unknown; errors?: unknown[]; extensions?: unknown };
  let body: GraphqlBody | null = null;
  try {
    const text = await response.text();
    body = text ? (JSON.parse(text) as GraphqlBody) : null;
  } catch {
    return {
      ok: false,
      class: response.status >= 500 ? "TRANSIENT_PROVIDER" : "GRAPHQL_PERMANENT",
      httpStatus: response.status,
      requestId,
      data: null,
      errors: null,
      cost: null,
      outcomeUnknown: false,
      message: safeMessage(`Shopify GraphQL returned non-JSON (${response.status})`),
    };
  }

  const cost = parseCost(body?.extensions);
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  if (!response.ok || errors.length > 0) {
    const classified = classifyGraphqlErrors(response.status, errors, cost);
    return {
      ok: false,
      class: classified,
      httpStatus: response.status,
      requestId,
      data: (body?.data as TData | undefined) ?? null,
      errors,
      cost,
      outcomeUnknown: false,
      message: safeMessage(
        classified === "THROTTLED"
          ? "Shopify GraphQL throttled"
          : `Shopify GraphQL request failed (${response.status})`
      ),
    };
  }

  return {
    ok: true,
    class: "SUCCESS",
    httpStatus: response.status,
    requestId,
    data: (body?.data as TData | undefined) ?? null,
    errors: null,
    cost,
    outcomeUnknown: false,
    message: "ok",
  };
}

export type ShopifyJobHandler = (
  claim: ShopifySyncJobClaim
) => Promise<ShopifyJobHandlerResult>;

const defaultHandlers: Record<string, ShopifyJobHandler> = {
  PROCESS_PROVIDER_EVIDENCE: (claim) => handleShopifyProcessProviderEvidenceJob(claim),
  CREATE_LISTING: (claim) => handleShopifyCreateListingJob(claim),
  UPDATE_LISTING_CONTENT: (claim) => handleShopifyUpdateListingContentJob(claim),
  PROJECT_INVENTORY: (claim) => handleShopifyProjectInventoryJob(claim),
};

/**
 * Claim one job, commit, then run handler outside the claim transaction.
 * At-least-once: a crash after provider success may reclaim and rerun.
 */
export async function runNextShopifySyncJob(input?: {
  workerId?: string;
  handlers?: Partial<Record<string, ShopifyJobHandler>>;
  leaseMs?: number;
  now?: Date;
}): Promise<{ claimed: false } | { claimed: true; jobId: string; finalized: boolean; result: ShopifyJobHandlerResult }> {
  const workerId = input?.workerId ?? `shopify-worker-${randomUUID()}`;
  const claim = await claimNextShopifySyncJob(prisma, {
    workerId,
    leaseMs: input?.leaseMs,
    now: input?.now,
  });
  if (!claim) return { claimed: false };

  const handlers = { ...defaultHandlers, ...input?.handlers };
  const handler = handlers[claim.kind];
  let result: ShopifyJobHandlerResult;
  try {
    if (!handler) {
      result = {
        outcome: "DEAD",
        errorClass: "GRAPHQL_PERMANENT",
        errorCode: "NO_HANDLER",
        errorMessage: `No handler for ${claim.kind}`,
      };
    } else {
      result = await handler(claim);
    }
  } catch (error) {
    result = {
      outcome: "RETRY",
      errorClass: "TRANSIENT_PROVIDER",
      errorCode: "HANDLER_THROW",
      errorMessage: safeMessage(error instanceof Error ? error.message : "handler failed"),
    };
  }

  const now = input?.now ?? new Date();
  let finalized = false;
  if (result.outcome === "SUCCESS") {
    finalized = await completeShopifySyncJobSuccess(prisma, claim, now);
  } else if (result.outcome === "RETRY") {
    finalized = await completeShopifySyncJobRetry(prisma, claim, result, now);
  } else {
    finalized = await completeShopifySyncJobDead(prisma, claim, result, now);
  }
  return { claimed: true, jobId: claim.id, finalized, result };
}
