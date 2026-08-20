"use client";

import { useEffect, useState } from "react";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { IonIcon } from "@/components/IonIcon";

type AuditLogEntry = {
  id: string;
  provider: string;
  previousQty: number;
  newQty: number;
  delta: number;
  reason: string;
  createdAt: string;
};

const REASON_LABELS: Record<string, string> = {
  sale: "Sale",
  restock: "Restock",
  sync_pull: "Synced from channel",
  manual_edit: "Manual edit",
  refund: "Refund / cancel",
  bulk_edit: "Bulk edit",
  import: "Import",
  sync_push: "Pushed to channel",
};

const PROVIDER_NAMES: Record<string, string> = {
  inwc: "NWC Store",
  etsy: "Etsy",
  ebay: "eBay",
  shopify: "Shopify",
  wix: "Wix",
};

export function MyItemsQuantityHistoryModal({
  storeItemId,
  title,
  onClose,
}: {
  storeItemId: string;
  title: string;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useLockBodyScroll(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/seller/quantity-audit?storeItemId=${encodeURIComponent(storeItemId)}&limit=50`, {
      credentials: "include",
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed to load history");
        if (!cancelled) setLogs(Array.isArray((data as { logs?: AuditLogEntry[] }).logs) ? (data as { logs: AuditLogEntry[] }).logs : []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [storeItemId]);

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center p-4 bg-black/40" role="dialog" aria-label="Quantity history">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg max-h-[80vh] overflow-hidden rounded-xl border-2 bg-white shadow-xl flex flex-col" style={{ borderColor: "var(--color-primary)" }}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
          <div className="min-w-0">
            <h2 className="text-base font-bold truncate" style={{ color: "var(--color-heading)" }}>
              Quantity history
            </h2>
            <p className="text-xs text-gray-600 truncate">{title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-100"
            aria-label="Close"
          >
            <IonIcon name="close" size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : error ? (
            <p className="text-sm text-red-700">{error}</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-gray-500">No quantity changes recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {logs.map((log) => {
                const deltaLabel = log.delta > 0 ? `+${log.delta}` : String(log.delta);
                return (
                  <li key={log.id} className="text-sm border rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold" style={{ color: "var(--color-heading)" }}>
                        {REASON_LABELS[log.reason] ?? log.reason}
                      </span>
                      <span className={log.delta > 0 ? "text-green-700 font-semibold" : log.delta < 0 ? "text-red-700 font-semibold" : "text-gray-600"}>
                        {deltaLabel}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {log.previousQty} → {log.newQty}
                      {" · "}
                      {PROVIDER_NAMES[log.provider] ?? log.provider}
                      {" · "}
                      {new Date(log.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
