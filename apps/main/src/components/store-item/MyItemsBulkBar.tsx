"use client";

import { useState } from "react";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { CHANNEL_PROVIDER_LABELS } from "@/lib/channels/provider-ui";
import type { ChannelConnectionSummary } from "@/lib/channel-connections-client";
import { listOnConnections } from "@/lib/channel-connections-client";
import type { ItemsTab, MyStoreItem } from "@/components/store-item/my-items-types";
import { ListOnChannelCategoryModal } from "@/components/store-item/ListOnChannelCategoryModal";
import { BulkDestinationGridModal } from "@/components/store-item/BulkDestinationGridModal";
import {
  buildListOnCategoryQueueFromDesired,
  buildListOnCategoryQueueFromFailedSpecifics,
  isMissingEbayItemSpecificsError,
  type ListOnCategoryAssignment,
} from "@/lib/list-on-channel-category";
import type { ChannelActionResult } from "@/components/store-item/ChannelActionResultModal";
import {
  desiredProvidersByItemId,
  bulkDestinationFailTitle,
  summarizeBulkDestinations,
  type BulkDestinationAction,
  type BulkDestinationsResultCounts,
  type DestinationAssignment,
} from "@/lib/store-item-bulk-destinations";
import {
  endOnInwConfirm,
  endOnInwResult,
  hasLinkedChannelListings,
  uniqueLinkedShopNames,
} from "@/lib/store-item-ended-status";

function itemLinkedTo(item: MyStoreItem, provider: string): boolean {
  return (item.channelLinks ?? []).some((l) => l.provider === provider && !l.remoteDeletedProvider);
}

export function MyItemsBulkBar({
  tab,
  selectedIds,
  selectedItems,
  connections,
  onClear,
  onDone,
  onActionResult,
}: {
  tab: ItemsTab;
  selectedIds: string[];
  selectedItems: MyStoreItem[];
  connections: ChannelConnectionSummary[];
  onClear: () => void;
  onDone: () => void;
  onActionResult?: (result: ChannelActionResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [panel, setPanel] = useState<"edit" | null>(null);
  const [gridAction, setGridAction] = useState<BulkDestinationAction | null>(null);
  const [priceChangePercent, setPriceChangePercent] = useState("");
  const [quantityAdjust, setQuantityAdjust] = useState("");
  const [syncAfterEdit, setSyncAfterEdit] = useState(true);
  const [pendingAssignments, setPendingAssignments] = useState<DestinationAssignment[] | null>(null);
  const [categorySteps, setCategorySteps] = useState<ReturnType<typeof buildListOnCategoryQueueFromDesired> | null>(
    null
  );

  const connected = listOnConnections(connections);
  const connectedProviders = connected.map((c) => c.provider);
  const missingHints = connected
    .map((c) => {
      const missing = selectedItems.filter((item) => !itemLinkedTo(item, c.provider)).length;
      return missing > 0 ? `${missing} not on ${CHANNEL_PROVIDER_LABELS[c.provider] ?? c.provider}` : null;
    })
    .filter(Boolean)
    .join(" · ");

  useLockBodyScroll(panel != null || gridAction != null);

  if (selectedIds.length === 0) return null;

  async function jsonFetch<T>(url: string, init: RequestInit): Promise<T> {
    const res = await fetch(url, { credentials: "include", ...init });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const body = data as { error?: string; detail?: string };
      throw new Error(body.detail ?? body.error ?? `Request failed (${res.status})`);
    }
    return data as T;
  }

  function notify(title: string, message: string, ok = true) {
    if (onActionResult) {
      onActionResult({ title, message, ok });
      return;
    }
    alert(message);
  }

  async function applyDestinations(
    action: BulkDestinationAction,
    assignments: DestinationAssignment[],
    categoryAssignments?: ListOnCategoryAssignment[]
  ) {
    if (action === "sync" && !categoryAssignments) {
      const queue = buildListOnCategoryQueueFromDesired(
        selectedItems,
        desiredProvidersByItemId(assignments)
      );
      if (queue.length > 0) {
        setPendingAssignments(assignments);
        setGridAction(null);
        setCategorySteps(queue);
        return;
      }
    }
    setLoading(true);
    try {
      const result = await jsonFetch<BulkDestinationsResultCounts>("/api/store-items/bulk-destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          items: assignments,
          ...(categoryAssignments?.length ? { assignments: categoryAssignments } : {}),
        }),
      });
      const failedSpecificIds = (result.results ?? [])
        .filter((row) => row.status === "failed" && isMissingEbayItemSpecificsError(row.detail))
        .map((row) => row.itemId);
      if (action === "sync" && failedSpecificIds.length > 0 && !categoryAssignments) {
        const queue = buildListOnCategoryQueueFromFailedSpecifics(selectedItems, failedSpecificIds);
        if (queue.length > 0) {
          setPendingAssignments(assignments);
          setGridAction(null);
          setCategorySteps(queue);
          return;
        }
      }
      const summary = summarizeBulkDestinations(action, result);
      notify(summary.title, summary.message, summary.ok);
      setGridAction(null);
      setCategorySteps(null);
      setPendingAssignments(null);
      onDone();
      onClear();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "That update didn't go through.";
      notify(bulkDestinationFailTitle(action), msg, false);
      if (categoryAssignments) throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function bulkEnd() {
    const shopNames = uniqueLinkedShopNames(selectedItems, CHANNEL_PROVIDER_LABELS);
    if (!window.confirm(endOnInwConfirm(selectedIds.length, shopNames))) return;
    setLoading(true);
    try {
      const result = await jsonFetch<{ updated: number; failed: number }>("/api/store-items/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeItemIds: selectedIds,
          updates: { status: "inactive" },
          syncToChannels: false,
        }),
      });
      const summary = endOnInwResult(result.updated, result.failed, shopNames);
      notify(summary.title, summary.message, summary.ok);
      onDone();
      onClear();
    } catch (e) {
      notify("Couldn't End Those Listings", e instanceof Error ? e.message : "End didn't go through.", false);
    } finally {
      setLoading(false);
    }
  }

  async function bulkRelist() {
    if (!window.confirm(`Relist ${selectedIds.length} item${selectedIds.length === 1 ? "" : "s"} with quantity 1 each?`)) {
      return;
    }
    setLoading(true);
    try {
      const result = await jsonFetch<{ relisted?: number; error?: string }>("/api/store-items/bulk-relist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemIds: selectedIds, quantity: 1, republishChannels: false }),
      });
      const n = result.relisted ?? selectedIds.length;
      notify("Back On The Floor", `Relisted ${n} item${n === 1 ? "" : "s"} with quantity 1.`);
      onDone();
      onClear();
    } catch (e) {
      notify("Couldn't Relist", e instanceof Error ? e.message : "Relist didn't go through.", false);
    } finally {
      setLoading(false);
    }
  }

  async function applyEdit() {
    if (!priceChangePercent && !quantityAdjust) {
      notify("Nothing To Apply", "Add a price change percent and/or a quantity adjustment first.", false);
      return;
    }
    setLoading(true);
    try {
      const updates: Record<string, unknown> = {};
      if (priceChangePercent) updates.priceChangePercent = parseFloat(priceChangePercent);
      if (quantityAdjust) updates.quantityAdjust = parseInt(quantityAdjust, 10);
      const result = await jsonFetch<{ updated: number; failed: number }>("/api/store-items/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeItemIds: selectedIds,
          updates,
          syncToChannels: syncAfterEdit,
        }),
      });
      if (result.failed > 0) {
        notify("Updated Some, Missed Some", `Updated ${result.updated}. ${result.failed} didn't go through.`, false);
      } else {
        notify(
          "Numbers Updated",
          `Updated ${result.updated} item${result.updated === 1 ? "" : "s"}.`
        );
      }
      setPanel(null);
      setPriceChangePercent("");
      setQuantityAdjust("");
      onDone();
      onClear();
    } catch (e) {
      notify("Couldn't Apply That Edit", e instanceof Error ? e.message : "Bulk edit didn't go through.", false);
    } finally {
      setLoading(false);
    }
  }

  const dockBtn =
    "min-h-11 w-full px-4 rounded-xl border-2 bg-white text-sm font-semibold hover:bg-[var(--color-section-alt)] disabled:opacity-50";

  return (
    <>
      <div
        className="fixed bottom-3 left-3 right-3 z-50 mx-auto max-w-[var(--max-width)] xl:max-w-[1520px]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div
          className="rounded-2xl border-2 bg-white p-4 shadow-[0_12px_40px_rgba(62,67,47,0.18)]"
          style={{ borderColor: "var(--color-primary)" }}
          role="toolbar"
          aria-label="Bulk listing actions"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <p className="text-base font-bold" style={{ color: "var(--color-heading)" }}>
                {selectedIds.length} selected
              </p>
              {missingHints ? <p className="text-xs text-gray-600 mt-0.5">{missingHints}</p> : null}
            </div>
            <button
              type="button"
              className="text-sm font-semibold text-gray-600 px-2 py-1 shrink-0 hover:underline"
              disabled={loading}
              onClick={onClear}
            >
              Clear
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {tab !== "sold" && (
              <button
                type="button"
                className="btn min-h-11 w-full col-span-2 sm:col-span-1 text-sm"
                disabled={loading}
                onClick={() => setGridAction("sync")}
              >
                Manage Listings
              </button>
            )}
            {tab === "active" && (
              <>
                <button
                  type="button"
                  className={dockBtn}
                  disabled={loading}
                  onClick={() => {
                    if (hasLinkedChannelListings(selectedItems)) {
                      setGridAction("end");
                      return;
                    }
                    void bulkEnd();
                  }}
                >
                  End Listings
                </button>
                <button type="button" className={dockBtn} disabled={loading} onClick={() => setPanel("edit")}>
                  Price / Quantity
                </button>
              </>
            )}
            {(tab === "ended" || tab === "sold") && (
              <button type="button" className={dockBtn} disabled={loading} onClick={() => void bulkRelist()}>
                Relist
              </button>
            )}
          </div>
        </div>
      </div>

      {gridAction ? (
        <BulkDestinationGridModal
          action={gridAction}
          items={selectedItems}
          connectedProviders={connectedProviders}
          loading={loading}
          onClose={() => setGridAction(null)}
          onApply={(assignments) => applyDestinations(gridAction, assignments)}
        />
      ) : null}

      {panel === "edit" && (
        <div className="fixed inset-0 z-[240] flex items-center justify-center p-4 bg-black/40">
          <button type="button" className="absolute inset-0" aria-label="Close" onClick={() => setPanel(null)} />
          <div className="relative z-10 w-full max-w-md rounded-xl border-2 bg-white p-5 shadow-xl" style={{ borderColor: "var(--color-primary)" }}>
            <h3 className="text-base font-bold mb-3" style={{ color: "var(--color-heading)" }}>
              Price / Quantity
            </h3>
            <label className="block text-sm font-medium mb-1">Price change (%)</label>
            <input
              type="number"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
              placeholder="e.g. -10 or 20"
              value={priceChangePercent}
              onChange={(e) => setPriceChangePercent(e.target.value)}
            />
            <label className="block text-sm font-medium mb-1">Quantity adjustment</label>
            <input
              type="number"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
              placeholder="e.g. 5 or -3"
              value={quantityAdjust}
              onChange={(e) => setQuantityAdjust(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm mb-4">
              <input type="checkbox" checked={syncAfterEdit} onChange={(e) => setSyncAfterEdit(e.target.checked)} />
              Sync changes to connected channels
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="text-sm px-3 py-2" onClick={() => setPanel(null)}>
                Cancel
              </button>
              <button type="button" className="btn text-sm" disabled={loading} onClick={() => void applyEdit()}>
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {categorySteps && categorySteps.length > 0 ? (
        <ListOnChannelCategoryModal
          steps={categorySteps}
          onClose={() => {
            setCategorySteps(null);
            setPendingAssignments(null);
          }}
          onComplete={(assignments) => {
            if (!pendingAssignments) return;
            return applyDestinations("sync", pendingAssignments, assignments);
          }}
        />
      ) : null}
    </>
  );
}
