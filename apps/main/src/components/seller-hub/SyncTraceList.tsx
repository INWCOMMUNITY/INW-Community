"use client";

import { useCallback, useEffect, useState } from "react";

type SyncTrace = {
  id: string;
  provider: string;
  storeItemId: string;
  operation: string;
  status: string;
  errorCode: string | null;
  errorCategory: string | null;
  errorCategoryLabel: string | null;
  rootCause: string | null;
  suggestedFixes: string[];
  durationMs: number | null;
  createdAt: string;
};

type DiagnoseResponse = {
  ok: boolean;
  summary: string;
  connections: {
    provider: string;
    connected: boolean;
    status: string;
    linkedCount: number;
    errorCount: number;
  }[];
  recentTraces: SyncTrace[];
  failedTraces: SyncTrace[];
  stats: {
    totalLinked: number;
    totalErrors: number;
    totalTraces: number;
    successRate: number | null;
  };
};

const PROVIDER_LABEL: Record<string, string> = {
  etsy: "Etsy",
  ebay: "eBay",
  wix: "Wix",
  shopify: "Shopify",
};

const PROVIDER_COLOR: Record<string, string> = {
  etsy: "bg-orange-100 text-orange-700",
  ebay: "bg-blue-100 text-blue-700",
  wix: "bg-purple-100 text-purple-700",
  shopify: "bg-green-100 text-green-700",
};

const STATUS_COLOR: Record<string, string> = {
  success: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  validation_failed: "bg-amber-100 text-amber-700",
  pending: "bg-gray-100 text-gray-600",
};

const STATUS_LABEL: Record<string, string> = {
  success: "Success",
  failed: "Failed",
  validation_failed: "Validation Failed",
  pending: "Pending",
};

const OPERATION_LABEL: Record<string, string> = {
  create: "Create",
  update: "Update",
  delete: "Delete",
  inventory: "Inventory",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) return "Just now";
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

type Props = {
  onSelectTrace?: (traceId: string) => void;
  storeItemId?: string;
  provider?: string;
};

export function SyncTraceList({ onSelectTrace, storeItemId, provider }: Props) {
  const [data, setData] = useState<DiagnoseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllTraces, setShowAllTraces] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (storeItemId) params.set("storeItemId", storeItemId);
      if (provider) params.set("provider", provider);
      
      const res = await fetch(`/api/channels/diagnose?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load sync traces");
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [storeItemId, provider]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-4 bg-gray-200 rounded w-1/3"></div>
        <div className="h-20 bg-gray-100 rounded"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const failedTraces = data.failedTraces || [];
  const recentTraces = data.recentTraces || [];
  const allTraces = [...failedTraces, ...recentTraces]
    .filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const displayedTraces = showAllTraces ? allTraces : allTraces.slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Sync Traces</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {data.stats.totalTraces} traces • {data.stats.successRate != null ? `${data.stats.successRate}% success rate` : "No data"}
          </p>
        </div>
        <button
          onClick={load}
          className="text-xs text-[var(--color-primary)] hover:underline"
        >
          Refresh
        </button>
      </div>

      {/* Failed traces alert */}
      {failedTraces.length > 0 && (
        <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span className="text-sm font-medium text-red-700">
              {failedTraces.length} failed sync{failedTraces.length !== 1 ? "s" : ""}
            </span>
          </div>
          {failedTraces[0]?.rootCause && (
            <p className="text-xs text-red-600 mt-1 pl-6">
              {failedTraces[0].rootCause}
            </p>
          )}
        </div>
      )}

      {/* Trace list */}
      {displayedTraces.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">
          No sync traces yet. Traces appear when listings are synced to channels.
        </p>
      ) : (
        <div className="space-y-2">
          {displayedTraces.map((trace) => (
            <div
              key={trace.id}
              onClick={() => onSelectTrace?.(trace.id)}
              className={`p-3 bg-white border rounded-lg ${
                onSelectTrace ? "cursor-pointer hover:border-[var(--color-primary)] hover:shadow-sm" : ""
              } transition-all`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${PROVIDER_COLOR[trace.provider] || "bg-gray-100 text-gray-600"}`}>
                    {PROVIDER_LABEL[trace.provider] || trace.provider}
                  </span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${STATUS_COLOR[trace.status]}`}>
                    {STATUS_LABEL[trace.status] || trace.status}
                  </span>
                  <span className="text-xs text-gray-500">
                    {OPERATION_LABEL[trace.operation] || trace.operation}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  {trace.durationMs != null && (
                    <span>{formatDuration(trace.durationMs)}</span>
                  )}
                  <span>{formatTime(trace.createdAt)}</span>
                </div>
              </div>

              {(trace.status === "failed" || trace.status === "validation_failed") && (
                <div className="mt-2">
                  {trace.errorCategoryLabel && (
                    <p className="text-xs font-medium text-red-600">
                      {trace.errorCategoryLabel}
                      {trace.errorCode && <span className="text-red-400 ml-1">#{trace.errorCode}</span>}
                    </p>
                  )}
                  {trace.rootCause && (
                    <p className="text-xs text-gray-600 mt-0.5">{trace.rootCause}</p>
                  )}
                  {trace.suggestedFixes.length > 0 && (
                    <div className="mt-1.5">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">Fix:</p>
                      <p className="text-xs text-gray-600">{trace.suggestedFixes[0]}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Show more button */}
      {allTraces.length > 5 && (
        <button
          onClick={() => setShowAllTraces(!showAllTraces)}
          className="text-xs text-[var(--color-primary)] font-medium hover:underline"
        >
          {showAllTraces ? "Show less" : `Show all ${allTraces.length} traces`}
        </button>
      )}
    </div>
  );
}
