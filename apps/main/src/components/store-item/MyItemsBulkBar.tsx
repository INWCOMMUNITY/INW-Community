"use client";

import { useState } from "react";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { CHANNEL_PROVIDER_LABELS } from "@/lib/channels/provider-ui";
import type { ChannelConnectionSummary } from "@/lib/channel-connections-client";
import { publishReadyConnections } from "@/lib/channel-connections-client";
import type { ItemsTab, MyStoreItem } from "@/components/store-item/my-items-types";
import { ListOnChannelCategoryModal } from "@/components/store-item/ListOnChannelCategoryModal";
import { buildListOnCategoryQueue, type ListOnCategoryAssignment } from "@/lib/list-on-channel-category";
import type { ChannelActionResult } from "@/components/store-item/ChannelActionResultModal";

function itemLinkedTo(item: MyStoreItem, provider: string): boolean {
  return (item.channelLinks ?? []).some((l) => l.provider === provider);
}

function itemsMissingProvider(items: MyStoreItem[], provider: string): MyStoreItem[] {
  return items.filter((item) => !itemLinkedTo(item, provider));
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
  const [panel, setPanel] = useState<"edit" | "publish" | null>(null);
  const [priceChangePercent, setPriceChangePercent] = useState("");
  const [quantityAdjust, setQuantityAdjust] = useState("");
  const [syncAfterEdit, setSyncAfterEdit] = useState(true);
  const [publishProviders, setPublishProviders] = useState<string[]>([]);
  const [pendingProviders, setPendingProviders] = useState<string[]>([]);
  const [categorySteps, setCategorySteps] = useState<ReturnType<typeof buildListOnCategoryQueue> | null>(
    null
  );

  const readyProviders = publishReadyConnections(connections);
  const listOnChannels = readyProviders
    .map((c) => ({
      ...c,
      missing: itemsMissingProvider(selectedItems, c.provider),
    }))
    .filter((c) => c.missing.length > 0);
  useLockBodyScroll(panel != null);

  if (selectedIds.length === 0) return null;

  async function jsonFetch<T>(url: string, init: RequestInit): Promise<T> {
    const res = await fetch(url, { credentials: "include", ...init });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
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

  async function bulkEnd() {
    if (!window.confirm(`End ${selectedIds.length} listing${selectedIds.length === 1 ? "" : "s"}? They will move to Ended.`)) {
      return;
    }
    setLoading(true);
    try {
      const result = await jsonFetch<{ updated: number; failed: number }>("/api/store-items/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeItemIds: selectedIds,
          updates: { status: "inactive" },
          syncToChannels: true,
        }),
      });
      if (result.failed > 0) {
        notify("Bulk end", `Ended ${result.updated}. ${result.failed} failed.`, false);
      }
      onDone();
      onClear();
    } catch (e) {
      notify("Bulk end failed", e instanceof Error ? e.message : "Bulk end failed", false);
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
      notify("Relisted", `Relisted ${result.relisted ?? selectedIds.length} item(s).`);
      onDone();
      onClear();
    } catch (e) {
      notify("Bulk relist failed", e instanceof Error ? e.message : "Bulk relist failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function bulkDelete() {
    if (!window.confirm(`Permanently delete ${selectedIds.length} item${selectedIds.length === 1 ? "" : "s"}? This cannot be undone.`)) {
      return;
    }
    setLoading(true);
    try {
      await jsonFetch("/api/store-items/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemIds: selectedIds }),
      });
      onDone();
      onClear();
    } catch (e) {
      notify("Bulk delete failed", e instanceof Error ? e.message : "Bulk delete failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function bulkUnpublish() {
    if (!window.confirm(`Unlink ${selectedIds.length} item${selectedIds.length === 1 ? "" : "s"} from connected channels?`)) {
      return;
    }
    setLoading(true);
    try {
      const result = await jsonFetch<{ unpublished: number; failed: number }>("/api/store-items/bulk-unpublish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemIds: selectedIds }),
      });
      notify(
        "Unpublished",
        `Unpublished ${result.unpublished}.${result.failed ? ` ${result.failed} failed.` : ""}`
      );
      onDone();
      onClear();
    } catch (e) {
      notify("Bulk unpublish failed", e instanceof Error ? e.message : "Bulk unpublish failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function applyEdit() {
    if (!priceChangePercent && !quantityAdjust) {
      notify("Bulk edit", "Enter a price change percent and/or quantity adjustment.", false);
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
        notify("Bulk edit", `Updated ${result.updated}. ${result.failed} failed.`, false);
      }
      setPanel(null);
      setPriceChangePercent("");
      setQuantityAdjust("");
      onDone();
      onClear();
    } catch (e) {
      notify("Bulk edit failed", e instanceof Error ? e.message : "Bulk edit failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function applyPublish(providers: string[], assignments?: ListOnCategoryAssignment[]) {
    if (providers.length === 0) {
      notify("List on channel", "Select at least one channel.", false);
      return;
    }
    const queue = buildListOnCategoryQueue(selectedItems, providers);
    if (!assignments && queue.length > 0) {
      setPendingProviders(providers);
      setPanel(null);
      setCategorySteps(queue);
      return;
    }
    setLoading(true);
    try {
      const result = await jsonFetch<{ published: number; failed: number; skipped: number }>(
        "/api/store-items/bulk-publish",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeItemIds: selectedIds,
            providers,
            validateFirst: true,
            skipInvalid: true,
            ...(assignments?.length ? { assignments } : {}),
          }),
        }
      );
      notify(
        "List on channel",
        [
          `Listed: ${result.published}`,
          result.failed ? `Failed: ${result.failed}` : null,
          result.skipped ? `Skipped (already listed or invalid): ${result.skipped}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        result.failed === 0
      );
      setPanel(null);
      setCategorySteps(null);
      setPublishProviders([]);
      setPendingProviders([]);
      onDone();
      onClear();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Bulk publish failed";
      notify("List on channel failed", msg, false);
      if (assignments) throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function listOnProvider(provider: string, missingCount: number) {
    const label = CHANNEL_PROVIDER_LABELS[provider] ?? provider;
    if (
      !window.confirm(
        `List ${missingCount} item${missingCount === 1 ? "" : "s"} on ${label}? Items already on ${label} will be skipped.`
      )
    ) {
      return;
    }
    await applyPublish([provider]);
  }

  const actionBtn =
    "text-sm font-semibold px-3 py-1.5 rounded-full border bg-white hover:bg-[var(--color-section-alt)] disabled:opacity-50";

  return (
    <>
      <div
        className="fixed bottom-0 left-0 right-0 z-50 border-t-2 bg-[var(--color-section-alt)] px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.12)]"
        style={{
          borderColor: "var(--color-primary)",
          paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
        }}
        role="toolbar"
        aria-label="Bulk listing actions"
      >
        <div className="mx-auto flex max-w-[var(--max-width)] xl:max-w-[1520px] flex-wrap items-center gap-2">
          <span className="text-sm font-bold mr-1" style={{ color: "var(--color-heading)" }}>
            {selectedIds.length} selected
          </span>
          {tab !== "sold" &&
            listOnChannels.map((c) => (
              <button
                key={c.provider}
                type="button"
                className="btn text-sm"
                disabled={loading}
                onClick={() => void listOnProvider(c.provider, c.missing.length)}
              >
                List on {CHANNEL_PROVIDER_LABELS[c.provider] ?? c.provider}
                {c.missing.length !== selectedIds.length ? ` (${c.missing.length})` : ""}
              </button>
            ))}
          {tab !== "sold" && readyProviders.length > 1 && listOnChannels.length > 1 && (
            <button
              type="button"
              className={actionBtn}
              disabled={loading}
              onClick={() => {
                setPublishProviders(listOnChannels.map((c) => c.provider));
                setPanel("publish");
              }}
            >
              List on multiple
            </button>
          )}
          {tab === "active" && (
            <>
              <button type="button" className={actionBtn} disabled={loading} onClick={() => void bulkEnd()}>
                End
              </button>
              <button type="button" className={actionBtn} disabled={loading} onClick={() => setPanel("edit")}>
                Price / qty
              </button>
              <button type="button" className={actionBtn} disabled={loading} onClick={() => void bulkUnpublish()}>
                Unlink stores
              </button>
            </>
          )}
          {(tab === "ended" || tab === "sold") && (
            <button type="button" className={actionBtn} disabled={loading} onClick={() => void bulkRelist()}>
              Relist
            </button>
          )}
          <button
            type="button"
            className={`${actionBtn} text-red-700 border-red-300`}
            disabled={loading}
            onClick={() => void bulkDelete()}
          >
            Delete
          </button>
          <button
            type="button"
            className="text-sm font-semibold text-gray-600 px-2 py-1.5 ml-auto"
            disabled={loading}
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      </div>

      {panel === "edit" && (
        <div className="fixed inset-0 z-[240] flex items-center justify-center p-4 bg-black/40">
          <button type="button" className="absolute inset-0" aria-label="Close" onClick={() => setPanel(null)} />
          <div className="relative z-10 w-full max-w-md rounded-xl border-2 bg-white p-5 shadow-xl" style={{ borderColor: "var(--color-primary)" }}>
            <h3 className="text-base font-bold mb-3" style={{ color: "var(--color-heading)" }}>
              Edit {selectedIds.length} items
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

      {panel === "publish" && (
        <div className="fixed inset-0 z-[240] flex items-center justify-center p-4 bg-black/40">
          <button type="button" className="absolute inset-0" aria-label="Close" onClick={() => setPanel(null)} />
          <div className="relative z-10 w-full max-w-md rounded-xl border-2 bg-white p-5 shadow-xl" style={{ borderColor: "var(--color-primary)" }}>
            <h3 className="text-base font-bold mb-3" style={{ color: "var(--color-heading)" }}>
              List {selectedIds.length} items
            </h3>
            <p className="text-sm text-gray-600 mb-3">
              Only items that are not already live on a channel will be listed there.
            </p>
            <div className="space-y-2 mb-4">
              {listOnChannels.map((c) => (
                <label key={c.provider} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={publishProviders.includes(c.provider)}
                    onChange={() =>
                      setPublishProviders((prev) =>
                        prev.includes(c.provider) ? prev.filter((p) => p !== c.provider) : [...prev, c.provider]
                      )
                    }
                  />
                  {CHANNEL_PROVIDER_LABELS[c.provider] ?? c.provider}
                  {c.shopName ? ` · ${c.shopName}` : ""}
                  {` · ${c.missing.length} to list`}
                </label>
              ))}
              {listOnChannels.length === 0 && (
                <p className="text-sm text-gray-600">
                  Selected items are already listed on every connected store, or no store is ready. Check Sync
                  Stores.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="text-sm px-3 py-2" onClick={() => setPanel(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn text-sm"
                disabled={loading}
                onClick={() => void applyPublish(publishProviders)}
              >
                List
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
            setPendingProviders([]);
          }}
          onComplete={(assignments) => applyPublish(pendingProviders, assignments)}
        />
      ) : null}
    </>
  );
}
