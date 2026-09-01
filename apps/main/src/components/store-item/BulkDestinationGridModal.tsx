"use client";

import { useEffect, useMemo, useState } from "react";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { CHANNEL_PROVIDER_LABELS } from "@/lib/channels/provider-ui";
import type { ChannelProvider } from "@/lib/channels/types";
import {
  BULK_DESTINATION_COPY,
  MANAGE_LISTINGS_UNCHECK_NOTE,
  UNSYNC_INW_NOTE,
  assignmentsFromGrid,
  columnChecked,
  destinationColumns,
  gridHasCheckedCell,
  hasUnsyncInw,
  initialGridRows,
  isProviderCellEnabled,
  setGridColumn,
  type BulkDestinationAction,
  type BulkDestinationGridItem,
  type DestinationAssignment,
  type GridRowState,
} from "@/lib/store-item-bulk-destinations";

export function BulkDestinationGridModal({
  action,
  items,
  connectedProviders,
  loading,
  onClose,
  onApply,
}: {
  action: BulkDestinationAction;
  items: BulkDestinationGridItem[];
  connectedProviders: string[];
  loading?: boolean;
  onClose: () => void;
  onApply: (assignments: DestinationAssignment[]) => void | Promise<void>;
}) {
  const connectedKey = connectedProviders.join("|");
  const columns = useMemo(() => destinationColumns(connectedProviders), [connectedKey]);
  const itemKey = items.map((item) => item.id).join("|");
  const [rows, setRows] = useState<GridRowState[]>(() => initialGridRows(action, items, columns));
  useLockBodyScroll(true);

  useEffect(() => {
    setRows(initialGridRows(action, items, columns));
  }, [action, itemKey, columns]);

  const copy = BULK_DESTINATION_COPY[action];
  const unsyncNote = hasUnsyncInw(action, rows);
  const canApply = action === "sync" || gridHasCheckedCell(rows);

  function toggleInw(index: number) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, inw: !row.inw } : row)));
  }

  function toggleProvider(index: number, provider: ChannelProvider) {
    const item = items[index];
    if (!item || !isProviderCellEnabled(action, item, provider)) return;
    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? { ...row, providers: { ...row.providers, [provider]: !row.providers[provider] } }
          : row
      )
    );
  }

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center p-4 bg-black/40" role="dialog">
      <button type="button" className="absolute inset-0" aria-label="Close" onClick={onClose} />
      <div
        className="relative z-10 flex w-full max-w-4xl max-h-[min(90vh,720px)] flex-col overflow-hidden rounded-2xl border-2 bg-white shadow-xl"
        style={{ borderColor: "var(--color-primary)" }}
      >
        <div className="border-b px-5 py-4" style={{ backgroundColor: "var(--color-section-alt)" }}>
          <h3 className="text-base font-bold uppercase tracking-wide" style={{ color: "var(--color-heading)" }}>
            {copy.title}
          </h3>
          <p className="text-sm text-gray-700 mt-2">{copy.body}</p>
          {action === "sync" ? (
            <p className="text-sm text-amber-950 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              {MANAGE_LISTINGS_UNCHECK_NOTE}
            </p>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left font-semibold px-2 py-2 sticky top-0 bg-white" style={{ color: "var(--color-heading)" }}>
                  Item
                </th>
                {columns.map((provider) => (
                  <th key={provider} className="px-2 py-2 text-center sticky top-0 bg-white">
                    <label className="inline-flex flex-col items-center gap-1 cursor-pointer">
                      <span className="font-semibold" style={{ color: "var(--color-heading)" }}>
                        {CHANNEL_PROVIDER_LABELS[provider] ?? provider}
                      </span>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--color-primary)]"
                        checked={columnChecked(rows, items, provider, action)}
                        onChange={(e) =>
                          setRows((prev) => setGridColumn(prev, items, provider, e.target.checked, action))
                        }
                        aria-label={`Select all ${CHANNEL_PROVIDER_LABELS[provider] ?? provider}`}
                      />
                    </label>
                  </th>
                ))}
                <th className="px-2 py-2 text-center sticky top-0 bg-white">
                  <label className="inline-flex flex-col items-center gap-1 cursor-pointer">
                    <span className="font-semibold" style={{ color: "var(--color-heading)" }}>
                      INW
                    </span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--color-primary)]"
                      checked={columnChecked(rows, items, "inw", action)}
                      onChange={(e) =>
                        setRows((prev) => setGridColumn(prev, items, "inw", e.target.checked, action))
                      }
                      aria-label="Select all INW"
                    />
                  </label>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const row = rows[index];
                if (!row) return null;
                return (
                  <tr key={item.id} className="border-b last:border-b-0">
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-3 min-w-0">
                        {item.photos[0] ? (
                          <img src={item.photos[0]} alt="" className="w-10 h-10 object-cover rounded-md shrink-0" />
                        ) : (
                          <div className="w-10 h-10 bg-gray-200 rounded-md shrink-0" />
                        )}
                        <span className="font-medium truncate" style={{ color: "var(--color-heading)" }}>
                          {item.title}
                        </span>
                      </div>
                    </td>
                    {columns.map((provider) => {
                      const enabled = isProviderCellEnabled(action, item, provider);
                      return (
                        <td key={provider} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[var(--color-primary)] disabled:opacity-30"
                            checked={Boolean(row.providers[provider])}
                            disabled={!enabled}
                            onChange={() => toggleProvider(index, provider)}
                            aria-label={`${item.title} on ${CHANNEL_PROVIDER_LABELS[provider] ?? provider}`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--color-primary)]"
                        checked={row.inw}
                        onChange={() => toggleInw(index)}
                        aria-label={`${item.title} on INW`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {unsyncNote ? (
          <p className="px-5 py-3 text-sm text-amber-900 bg-amber-50 border-t border-amber-200">{UNSYNC_INW_NOTE}</p>
        ) : null}
        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <button type="button" className="text-sm font-semibold px-4 py-2" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="btn text-sm min-h-11 px-5"
            disabled={loading || !canApply}
            onClick={() => void onApply(assignmentsFromGrid(rows))}
          >
            {loading ? "Working…" : copy.apply}
          </button>
        </div>
      </div>
    </div>
  );
}
