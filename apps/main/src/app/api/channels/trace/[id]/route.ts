import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getTraceById } from "@/lib/channels/sync-trace";
import { getErrorCategoryLabel, getSuggestedFixes } from "@/lib/channels/error-classifiers-registry";

export const dynamic = "force-dynamic";

type TransformRemap = {
  from: string;
  to: string;
  reason?: string;
};

type TransformTrace = {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  remaps?: TransformRemap[];
  dropped?: string[];
  categorySchema?: { name: string; required: boolean }[];
};

type ValidationCheck = {
  name: string;
  passed: boolean;
  detail?: string;
  severity: "error" | "warning";
};

type ValidationResult = {
  valid: boolean;
  checks: ValidationCheck[];
};

type TraceDetailResponse = {
  id: string;
  memberId: string;
  provider: string;
  storeItemId: string;
  sku: string | null;
  categoryId: string | null;
  operation: string;
  status: string;
  
  inputSnapshot: Record<string, unknown> | null;
  validationResult: ValidationResult | null;
  transformTrace: TransformTrace | null;
  
  requestPayload: Record<string, unknown> | null;
  responsePayload: Record<string, unknown> | null;
  httpStatus: number | null;
  
  errorCode: string | null;
  errorCategory: string | null;
  errorCategoryLabel: string | null;
  errorMessage: string | null;
  rootCause: string | null;
  suggestedFixes: string[];
  
  durationMs: number | null;
  createdAt: string;
};

/**
 * GET /api/channels/trace/[id]
 *
 * Get full details of a sync trace.
 * 
 * Returns:
 *   - Complete input snapshot
 *   - Full request/response payloads
 *   - Transform trace with before/after diff
 *   - Validation results
 *   - Error classification and root cause
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Trace ID required" }, { status: 400 });
  }

  const trace = await getTraceById(id);
  if (!trace) {
    return NextResponse.json({ error: "Trace not found" }, { status: 404 });
  }

  // Security: only allow access to traces belonging to this member
  if (trace.memberId !== userId) {
    return NextResponse.json({ error: "Not authorized to view this trace" }, { status: 403 });
  }

  const response: TraceDetailResponse = {
    id: trace.id,
    memberId: trace.memberId,
    provider: trace.provider,
    storeItemId: trace.storeItemId,
    sku: trace.sku,
    categoryId: trace.categoryId,
    operation: trace.operation,
    status: trace.status,
    
    inputSnapshot: trace.inputSnapshot as Record<string, unknown> | null,
    validationResult: trace.validationResult as ValidationResult | null,
    transformTrace: trace.transformTrace as TransformTrace | null,
    
    requestPayload: trace.requestPayload as Record<string, unknown> | null,
    responsePayload: trace.responsePayload as Record<string, unknown> | null,
    httpStatus: trace.httpStatus,
    
    errorCode: trace.errorCode,
    errorCategory: trace.errorCategory,
    errorCategoryLabel: trace.errorCategory ? getErrorCategoryLabel(trace.errorCategory) : null,
    errorMessage: trace.errorMessage,
    rootCause: trace.rootCause,
    suggestedFixes: getSuggestedFixes(trace.errorCategory),
    
    durationMs: trace.durationMs,
    createdAt: trace.createdAt.toISOString(),
  };

  return NextResponse.json(response);
}
