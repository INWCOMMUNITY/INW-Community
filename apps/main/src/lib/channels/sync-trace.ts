/**
 * Structured sync trace capture for detailed diagnostics.
 * 
 * Captures input state, validation results, transform operations, API request/response,
 * and performs error classification for root cause analysis.
 * 
 * Non-blocking: trace writes happen asynchronously and never throw.
 */

import { prisma, Prisma } from "database";
import type { ChannelProvider } from "./types";

// ============================================================================
// Types
// ============================================================================

export type SyncTraceOperation = "create" | "update" | "delete" | "inventory";
export type SyncTraceStatus = "pending" | "success" | "failed" | "validation_failed";

export type ValidationCheck = {
  name: string;
  passed: boolean;
  detail?: string;
  severity: "error" | "warning";
};

export type ValidationResult = {
  valid: boolean;
  checks: ValidationCheck[];
};

export type TransformRemap = {
  from: string;
  to: string;
  reason?: string;
};

export type TransformTrace = {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  remaps?: TransformRemap[];
  dropped?: string[];
  categorySchema?: { name: string; required: boolean }[];
};

export type SyncTraceContext = {
  id: string;
  memberId: string;
  provider: ChannelProvider | string;
  storeItemId: string;
  sku: string | null;
  categoryId: string | null;
  operation: SyncTraceOperation;
  status: SyncTraceStatus;
  startedAt: number;

  inputSnapshot: Record<string, unknown> | null;
  validationResult: ValidationResult | null;
  transformTrace: TransformTrace | null;

  requestPayload: Record<string, unknown> | null;
  responsePayload: Record<string, unknown> | null;
  httpStatus: number | null;

  errorCode: string | null;
  errorCategory: string | null;
  errorMessage: string | null;
  rootCause: string | null;
};

// ============================================================================
// Context Lifecycle
// ============================================================================

/**
 * Start a new trace context for a sync operation.
 * Call `completeTrace()` when the operation finishes (success or failure).
 */
export function startTrace(
  memberId: string,
  provider: ChannelProvider | string,
  storeItemId: string,
  operation: SyncTraceOperation,
  options?: {
    sku?: string | null;
    categoryId?: string | null;
  }
): SyncTraceContext {
  return {
    id: generateTraceId(),
    memberId,
    provider,
    storeItemId,
    sku: options?.sku ?? null,
    categoryId: options?.categoryId ?? null,
    operation,
    status: "pending",
    startedAt: Date.now(),

    inputSnapshot: null,
    validationResult: null,
    transformTrace: null,

    requestPayload: null,
    responsePayload: null,
    httpStatus: null,

    errorCode: null,
    errorCategory: null,
    errorMessage: null,
    rootCause: null,
  };
}

/**
 * Record the initial input state (item data before transforms).
 */
export function addInputSnapshot(
  ctx: SyncTraceContext,
  snapshot: Record<string, unknown>
): void {
  ctx.inputSnapshot = sanitizePayload(snapshot);
}

/**
 * Record validation check results.
 */
export function addValidation(
  ctx: SyncTraceContext,
  result: ValidationResult
): void {
  ctx.validationResult = result;
}

/**
 * Record a transform operation (aspect remapping, merges, etc.).
 */
export function addTransform(
  ctx: SyncTraceContext,
  trace: TransformTrace
): void {
  ctx.transformTrace = {
    before: trace.before ? sanitizePayload(trace.before) : undefined,
    after: trace.after ? sanitizePayload(trace.after) : undefined,
    remaps: trace.remaps,
    dropped: trace.dropped,
    categorySchema: trace.categorySchema,
  };
}

/**
 * Record the API request payload being sent.
 */
export function addRequest(
  ctx: SyncTraceContext,
  payload: Record<string, unknown>
): void {
  ctx.requestPayload = sanitizePayload(payload);
}

/**
 * Record the API response.
 */
export function addResponse(
  ctx: SyncTraceContext,
  httpStatus: number,
  payload?: Record<string, unknown> | null
): void {
  ctx.httpStatus = httpStatus;
  ctx.responsePayload = payload ? sanitizePayload(payload) : null;
}

/**
 * Complete the trace and persist it to the database.
 * Automatically classifies errors and computes root cause for failed traces.
 * 
 * @param ctx - The trace context
 * @param status - Final status (success | failed | validation_failed)
 * @param error - Error object or message if the operation failed
 */
export async function completeTrace(
  ctx: SyncTraceContext,
  status: "success" | "failed" | "validation_failed",
  error?: unknown
): Promise<void> {
  ctx.status = status;

  if (status !== "success" && error) {
    const { code, category, message, rootCause } = classifyTraceError(ctx, error);
    ctx.errorCode = code;
    ctx.errorCategory = category;
    ctx.errorMessage = message;
    ctx.rootCause = rootCause;
  }

  const durationMs = Date.now() - ctx.startedAt;

  persistTrace(ctx, durationMs);
}

// ============================================================================
// Error Classification for Root Cause Analysis
// ============================================================================

type ErrorAnalysisResult = {
  code: string | null;
  category: string | null;
  message: string;
  rootCause: string | null;
};

/**
 * Analyze an error against trace context to determine root cause.
 * This is separate from the retry-focused error-classifier.ts and focuses
 * on diagnostic information for developers.
 */
function classifyTraceError(
  ctx: SyncTraceContext,
  error: unknown
): ErrorAnalysisResult {
  const message = extractErrorMessage(error);
  const code = extractErrorCode(error, message);
  
  // Try to find a matching classifier
  for (const classifier of TRACE_CLASSIFIERS) {
    if (classifier.provider !== "*" && classifier.provider !== ctx.provider) {
      continue;
    }
    if (!classifier.pattern.test(message)) {
      continue;
    }
    
    const rootCause = classifier.analyze(ctx, error);
    if (rootCause) {
      return {
        code,
        category: classifier.category,
        message,
        rootCause,
      };
    }
  }

  // Default classification based on generic patterns
  const category = categorizeErrorGeneric(message);
  return {
    code,
    category,
    message,
    rootCause: null,
  };
}

type TraceClassifier = {
  id: string;
  provider: string; // "*" for any
  pattern: RegExp;
  category: string;
  analyze: (ctx: SyncTraceContext, error: unknown) => string | null;
};

/**
 * Classifiers for known error patterns.
 * Extended by error-classifiers.ts for the full registry.
 */
const TRACE_CLASSIFIERS: TraceClassifier[] = [
  {
    id: "ebay_aspect_key_mismatch",
    provider: "ebay",
    pattern: /#25064|item specific|aspect.*required|required.*aspect/i,
    category: "aspect_mismatch",
    analyze: (ctx) => {
      const sent = Object.keys(
        (ctx.requestPayload?.product as Record<string, unknown>)?.aspects || {}
      );
      const expected = ctx.transformTrace?.categorySchema?.map((a) => a.name) || [];
      const required = ctx.transformTrace?.categorySchema
        ?.filter((a) => a.required)
        .map((a) => a.name) || [];
      
      const wrong = sent.filter(
        (k) => !expected.some((e) => e.toLowerCase() === k.toLowerCase())
      );
      const missing = required.filter(
        (r) => !sent.some((s) => s.toLowerCase() === r.toLowerCase())
      );

      const issues: string[] = [];
      if (wrong.length > 0) {
        issues.push(`Unrecognized aspect keys: ${wrong.join(", ")}`);
      }
      if (missing.length > 0) {
        issues.push(`Missing required aspects: ${missing.join(", ")}`);
      }
      
      if (issues.length > 0) {
        return issues.join(". ");
      }
      return null;
    },
  },
  {
    id: "ebay_condition_invalid",
    provider: "ebay",
    pattern: /condition.*invalid|invalid.*condition|#25021/i,
    category: "condition_invalid",
    analyze: (ctx) => {
      const sentCondition = (ctx.requestPayload as Record<string, unknown>)?.condition;
      const categoryId = ctx.categoryId;
      if (sentCondition && categoryId) {
        return `Condition "${sentCondition}" not valid for category ${categoryId}. Check eBay category-specific conditions.`;
      }
      return null;
    },
  },
  {
    id: "ebay_policy_missing",
    provider: "ebay",
    pattern: /policy.*required|fulfillment.*policy|return.*policy|payment.*policy/i,
    category: "policy_missing",
    analyze: () => {
      return "Business policies not configured. Go to Sync Stores > eBay to select policies.";
    },
  },
  {
    id: "auth_expired",
    provider: "*",
    pattern: /\b401\b|unauthorized|token.*expired|invalid.*token|authentication/i,
    category: "auth_expired",
    analyze: (ctx) => {
      return `${ctx.provider} access token expired or invalid. Reconnect in Sync Stores settings.`;
    },
  },
  {
    id: "rate_limited",
    provider: "*",
    pattern: /\b429\b|rate.?limit|too many requests/i,
    category: "rate_limit",
    analyze: (ctx) => {
      return `Hit ${ctx.provider} API rate limit. Operation will retry automatically.`;
    },
  },
  {
    id: "etsy_taxonomy_mismatch",
    provider: "etsy",
    pattern: /taxonomy.*invalid|category.*invalid|#1044/i,
    category: "taxonomy_invalid",
    analyze: (ctx) => {
      const taxonomyId = (ctx.inputSnapshot as Record<string, unknown>)?.etsyTaxonomyId;
      if (taxonomyId) {
        return `Etsy taxonomy ID ${taxonomyId} is invalid or deprecated. Update the listing category.`;
      }
      return "Etsy taxonomy/category mismatch. Select a valid Etsy category.";
    },
  },
  {
    id: "etsy_shipping_profile",
    provider: "etsy",
    pattern: /shipping.*profile|profile.*required/i,
    category: "shipping_missing",
    analyze: () => {
      return "Etsy shipping profile not configured. Go to Sync Stores > Etsy settings.";
    },
  },
];

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
    if (typeof e.error === "string") return e.error;
    if (typeof e.errors === "object" && Array.isArray(e.errors)) {
      return e.errors.map((err: unknown) => {
        if (typeof err === "string") return err;
        if (err && typeof err === "object") {
          const errObj = err as Record<string, unknown>;
          return errObj.message || errObj.longMessage || JSON.stringify(err);
        }
        return String(err);
      }).join("; ");
    }
  }
  return String(error);
}

function extractErrorCode(error: unknown, message: string): string | null {
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    if (typeof e.errorId === "number") return String(e.errorId);
    if (typeof e.errorId === "string") return e.errorId;
    if (typeof e.code === "string") return e.code;
    if (typeof e.code === "number") return String(e.code);
    if (e.errors && Array.isArray(e.errors) && e.errors.length > 0) {
      const first = e.errors[0] as Record<string, unknown>;
      if (typeof first.errorId === "number") return String(first.errorId);
      if (typeof first.code === "string") return first.code;
    }
  }
  
  // Try to extract from message
  const codeMatch = message.match(/#(\d+)/);
  if (codeMatch) return codeMatch[1];
  
  return null;
}

function categorizeErrorGeneric(message: string): string {
  const lower = message.toLowerCase();
  
  if (/aspect|item.?specific|attribute/i.test(lower)) return "aspect_mismatch";
  if (/condition/i.test(lower)) return "condition_invalid";
  if (/auth|token|unauthorized|401/i.test(lower)) return "auth_expired";
  if (/rate.?limit|429|too many/i.test(lower)) return "rate_limit";
  if (/policy/i.test(lower)) return "policy_missing";
  if (/category|taxonomy/i.test(lower)) return "category_invalid";
  if (/shipping|fulfillment/i.test(lower)) return "shipping_missing";
  if (/inventory|quantity|stock/i.test(lower)) return "inventory_error";
  if (/photo|image/i.test(lower)) return "photo_error";
  if (/price|currency/i.test(lower)) return "price_error";
  if (/validation|invalid|malformed/i.test(lower)) return "payload_invalid";
  if (/timeout|econnreset|network/i.test(lower)) return "network_error";
  if (/5\d{2}|internal.*error|unavailable/i.test(lower)) return "channel_unavailable";
  
  return "unknown";
}

// ============================================================================
// Persistence
// ============================================================================

/**
 * Persist trace to database. Non-blocking, never throws.
 */
function persistTrace(ctx: SyncTraceContext, durationMs: number): void {
  const data: Prisma.SyncTraceCreateInput = {
    id: ctx.id,
    memberId: ctx.memberId,
    provider: ctx.provider,
    storeItemId: ctx.storeItemId,
    sku: ctx.sku,
    categoryId: ctx.categoryId,
    operation: ctx.operation,
    status: ctx.status,
    inputSnapshot: (ctx.inputSnapshot ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    validationResult: (ctx.validationResult ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    transformTrace: (ctx.transformTrace ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    requestPayload: (ctx.requestPayload ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    responsePayload: (ctx.responsePayload ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    httpStatus: ctx.httpStatus,
    errorCode: ctx.errorCode,
    errorCategory: ctx.errorCategory,
    errorMessage: ctx.errorMessage,
    rootCause: ctx.rootCause,
    durationMs,
  };

  prisma.syncTrace
    .create({ data })
    .catch((e) => {
      console.warn("[sync-trace] failed to write", {
        traceId: ctx.id,
        error: String(e).slice(0, 200),
      });
    });
}

// ============================================================================
// Query Helpers
// ============================================================================

export type SyncTraceSummary = {
  id: string;
  provider: string;
  storeItemId: string;
  operation: string;
  status: string;
  errorCode: string | null;
  errorCategory: string | null;
  rootCause: string | null;
  transformTrace: TransformTrace | null;
  durationMs: number | null;
  createdAt: Date;
};

/**
 * Get recent traces for a member/provider/item.
 */
export async function getRecentTraces(
  memberId: string,
  provider: string,
  options?: {
    storeItemId?: string;
    limit?: number;
    status?: SyncTraceStatus;
  }
): Promise<SyncTraceSummary[]> {
  const traces = await prisma.syncTrace.findMany({
    where: {
      memberId,
      provider,
      ...(options?.storeItemId ? { storeItemId: options.storeItemId } : {}),
      ...(options?.status ? { status: options.status } : {}),
    },
    select: {
      id: true,
      provider: true,
      storeItemId: true,
      operation: true,
      status: true,
      errorCode: true,
      errorCategory: true,
      rootCause: true,
      transformTrace: true,
      durationMs: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: options?.limit ?? 10,
  });

  return traces.map((t) => ({
    ...t,
    transformTrace: t.transformTrace as TransformTrace | null,
  }));
}

/**
 * Get full trace details by ID.
 */
export async function getTraceById(
  traceId: string
): Promise<Prisma.SyncTraceGetPayload<object> | null> {
  return prisma.syncTrace.findUnique({
    where: { id: traceId },
  });
}

/**
 * Get recent failed traces for a member across all providers.
 */
export async function getRecentFailedTraces(
  memberId: string,
  options?: { limit?: number }
): Promise<SyncTraceSummary[]> {
  const traces = await prisma.syncTrace.findMany({
    where: {
      memberId,
      status: { in: ["failed", "validation_failed"] },
    },
    select: {
      id: true,
      provider: true,
      storeItemId: true,
      operation: true,
      status: true,
      errorCode: true,
      errorCategory: true,
      rootCause: true,
      transformTrace: true,
      durationMs: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: options?.limit ?? 20,
  });

  return traces.map((t) => ({
    ...t,
    transformTrace: t.transformTrace as TransformTrace | null,
  }));
}

// ============================================================================
// Utilities
// ============================================================================

function generateTraceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `tr_${timestamp}_${random}`;
}

/**
 * Sanitize payload for safe JSON storage.
 * Removes sensitive data and truncates large values.
 */
function sanitizePayload(obj: Record<string, unknown>): Record<string, unknown> {
  const MAX_STRING_LENGTH = 2000;
  const MAX_ARRAY_LENGTH = 50;
  const SENSITIVE_KEYS = ["password", "token", "secret", "apiKey", "accessToken", "refreshToken"];

  function sanitize(value: unknown, depth = 0): unknown {
    if (depth > 10) return "[max depth]";

    if (value === null || value === undefined) return value;

    if (typeof value === "string") {
      return value.length > MAX_STRING_LENGTH
        ? value.slice(0, MAX_STRING_LENGTH) + "...[truncated]"
        : value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (Array.isArray(value)) {
      const truncated = value.slice(0, MAX_ARRAY_LENGTH);
      const result = truncated.map((v) => sanitize(v, depth + 1));
      if (value.length > MAX_ARRAY_LENGTH) {
        result.push(`...[${value.length - MAX_ARRAY_LENGTH} more]`);
      }
      return result;
    }

    if (typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) {
          result[k] = "[redacted]";
        } else {
          result[k] = sanitize(v, depth + 1);
        }
      }
      return result;
    }

    return String(value);
  }

  return sanitize(obj) as Record<string, unknown>;
}

/**
 * Register additional classifiers from error-classifiers.ts.
 * Called during module initialization.
 */
export function registerTraceClassifier(classifier: TraceClassifier): void {
  TRACE_CLASSIFIERS.push(classifier);
}

/**
 * Export classifier type for use in error-classifiers.ts.
 */
export type { TraceClassifier };

// Auto-register extended classifiers (imported for side effects)
import "./error-classifiers-registry";
