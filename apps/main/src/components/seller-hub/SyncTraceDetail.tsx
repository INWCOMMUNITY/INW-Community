"use client";

import { useCallback, useEffect, useState } from "react";

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

type TraceDetail = {
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

const PROVIDER_LABEL: Record<string, string> = {
  etsy: "Etsy",
  ebay: "eBay",
  wix: "Wix",
  shopify: "Shopify",
};

const STATUS_COLOR: Record<string, string> = {
  success: "bg-green-100 text-green-700 border-green-200",
  failed: "bg-red-100 text-red-700 border-red-200",
  validation_failed: "bg-amber-100 text-amber-700 border-amber-200",
  pending: "bg-gray-100 text-gray-600 border-gray-200",
};

const STATUS_LABEL: Record<string, string> = {
  success: "Success",
  failed: "Failed",
  validation_failed: "Validation Failed",
  pending: "Pending",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

type Props = {
  traceId: string;
  onClose?: () => void;
};

export function SyncTraceDetail({ traceId, onClose }: Props) {
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["error", "validation"]));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/channels/trace/${traceId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load trace");
      const json = await res.json();
      setTrace(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [traceId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-4">
        <div className="h-6 bg-gray-200 rounded w-1/2"></div>
        <div className="h-32 bg-gray-100 rounded"></div>
      </div>
    );
  }

  if (error || !trace) {
    return (
      <div className="p-4">
        <div className="p-4 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">
          {error || "Trace not found"}
        </div>
        {onClose && (
          <button onClick={onClose} className="mt-4 text-sm text-[var(--color-primary)] hover:underline">
            ← Back
          </button>
        )}
      </div>
    );
  }

  const hasError = trace.status === "failed" || trace.status === "validation_failed";
  const hasTransforms = trace.transformTrace && (
    (trace.transformTrace.remaps?.length ?? 0) > 0 ||
    (trace.transformTrace.dropped?.length ?? 0) > 0
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            {onClose && (
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 className="text-lg font-semibold text-gray-800">Sync Trace</h2>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {PROVIDER_LABEL[trace.provider] || trace.provider} • {trace.operation} • {formatDateTime(trace.createdAt)}
          </p>
        </div>
        <div className={`px-2 py-1 text-xs font-medium rounded border ${STATUS_COLOR[trace.status]}`}>
          {STATUS_LABEL[trace.status] || trace.status}
        </div>
      </div>

      {/* Basic info */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-gray-500">Duration:</span>
          <span className="ml-2 text-gray-800">{trace.durationMs != null ? `${trace.durationMs}ms` : "-"}</span>
        </div>
        {trace.sku && (
          <div>
            <span className="text-gray-500">SKU:</span>
            <span className="ml-2 text-gray-800 font-mono text-xs">{trace.sku}</span>
          </div>
        )}
        {trace.categoryId && (
          <div>
            <span className="text-gray-500">Category:</span>
            <span className="ml-2 text-gray-800">{trace.categoryId}</span>
          </div>
        )}
        {trace.httpStatus && (
          <div>
            <span className="text-gray-500">HTTP:</span>
            <span className={`ml-2 ${trace.httpStatus >= 400 ? "text-red-600" : "text-green-600"}`}>
              {trace.httpStatus}
            </span>
          </div>
        )}
      </div>

      {/* Error section */}
      {hasError && (
        <CollapsibleSection
          title="Error Analysis"
          expanded={expandedSections.has("error")}
          onToggle={() => toggleSection("error")}
          variant="error"
        >
          <div className="space-y-3">
            {trace.errorCategoryLabel && (
              <div>
                <span className="text-xs text-gray-500 uppercase tracking-wide">Category</span>
                <p className="text-sm text-red-700 font-medium">
                  {trace.errorCategoryLabel}
                  {trace.errorCode && <span className="text-red-400 ml-1 font-normal">#{trace.errorCode}</span>}
                </p>
              </div>
            )}
            {trace.rootCause && (
              <div>
                <span className="text-xs text-gray-500 uppercase tracking-wide">Root Cause</span>
                <p className="text-sm text-gray-800">{trace.rootCause}</p>
              </div>
            )}
            {trace.errorMessage && trace.errorMessage !== trace.rootCause && (
              <div>
                <span className="text-xs text-gray-500 uppercase tracking-wide">Error Message</span>
                <p className="text-xs text-gray-600 font-mono bg-gray-50 p-2 rounded overflow-auto max-h-24">
                  {trace.errorMessage}
                </p>
              </div>
            )}
            {trace.suggestedFixes.length > 0 && (
              <div>
                <span className="text-xs text-gray-500 uppercase tracking-wide">Suggested Fixes</span>
                <ul className="mt-1 space-y-1">
                  {trace.suggestedFixes.map((fix, i) => (
                    <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                      <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      {fix}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Validation section */}
      {trace.validationResult && (
        <CollapsibleSection
          title={`Validation (${trace.validationResult.checks.filter((c) => c.passed).length}/${trace.validationResult.checks.length} passed)`}
          expanded={expandedSections.has("validation")}
          onToggle={() => toggleSection("validation")}
          variant={trace.validationResult.valid ? "success" : "warning"}
        >
          <div className="space-y-2">
            {trace.validationResult.checks.map((check, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                {check.passed ? (
                  <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : check.severity === "error" ? (
                  <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                )}
                <div className="flex-1">
                  <span className={`font-medium ${check.passed ? "text-gray-700" : check.severity === "error" ? "text-red-700" : "text-amber-700"}`}>
                    {check.name}
                  </span>
                  {check.detail && (
                    <span className="text-gray-500 ml-2">{check.detail}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Transform section */}
      {hasTransforms && (
        <CollapsibleSection
          title="Aspect Transforms"
          expanded={expandedSections.has("transform")}
          onToggle={() => toggleSection("transform")}
        >
          <div className="space-y-3">
            {(trace.transformTrace?.remaps?.length ?? 0) > 0 && (
              <div>
                <span className="text-xs text-gray-500 uppercase tracking-wide">Value Adjustments</span>
                <div className="mt-1 space-y-1">
                  {trace.transformTrace?.remaps?.map((r, i) => (
                    <div key={i} className="text-sm flex items-center gap-2">
                      <span className="text-red-500 line-through">{r.from}</span>
                      <span className="text-gray-400">→</span>
                      <span className="text-green-600">{r.to}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(trace.transformTrace?.dropped?.length ?? 0) > 0 && (
              <div>
                <span className="text-xs text-gray-500 uppercase tracking-wide">Dropped Aspects</span>
                <p className="text-sm text-amber-600">
                  {trace.transformTrace?.dropped?.join(", ")}
                </p>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Request payload */}
      {trace.requestPayload && (
        <CollapsibleSection
          title="Request Payload"
          expanded={expandedSections.has("request")}
          onToggle={() => toggleSection("request")}
        >
          <JsonViewer data={trace.requestPayload} />
        </CollapsibleSection>
      )}

      {/* Response payload */}
      {trace.responsePayload && (
        <CollapsibleSection
          title="Response Payload"
          expanded={expandedSections.has("response")}
          onToggle={() => toggleSection("response")}
        >
          <JsonViewer data={trace.responsePayload} />
        </CollapsibleSection>
      )}

      {/* Input snapshot */}
      {trace.inputSnapshot && (
        <CollapsibleSection
          title="Input Snapshot"
          expanded={expandedSections.has("input")}
          onToggle={() => toggleSection("input")}
        >
          <JsonViewer data={trace.inputSnapshot} />
        </CollapsibleSection>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  expanded,
  onToggle,
  variant = "default",
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  variant?: "default" | "error" | "warning" | "success";
  children: React.ReactNode;
}) {
  const variantStyles = {
    default: "bg-white border-gray-200",
    error: "bg-red-50 border-red-100",
    warning: "bg-amber-50 border-amber-100",
    success: "bg-green-50 border-green-100",
  };

  return (
    <div className={`border rounded-lg overflow-hidden ${variantStyles[variant]}`}>
      <button
        onClick={onToggle}
        className="w-full px-4 py-2 flex items-center justify-between text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        {title}
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && <div className="px-4 py-3 border-t border-gray-100">{children}</div>}
    </div>
  );
}

function JsonViewer({ data }: { data: Record<string, unknown> }) {
  return (
    <pre className="text-xs text-gray-700 font-mono bg-gray-50 p-3 rounded overflow-auto max-h-64">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
