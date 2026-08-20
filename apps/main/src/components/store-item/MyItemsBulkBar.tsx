"use client";

import { useState } from "react";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { CHANNEL_PROVIDER_LABELS } from "@/lib/channels/provider-ui";
import type { ChannelConnectionSummary } from "@/lib/channel-connections-client";
import { publishReadyConnections } from "@/lib/channel-connections-client";
import type { ItemsTab, MyStoreItem } from "@/components/store-item/my-items-types";
import { ListOnChannelCategoryModal } from "@/components/store-item/ListOnChannelCategoryModal";
import { buildListOnCategoryQueue, type ListOnCategoryAssignment } from "@/lib/list-on-channel-category";

export function MyItemsBulkBar({
  tab,
  selectedIds,
  selectedItems,
  connections,
  onClear,
  onDone,
}: {
  tab: ItemsTab;
  selectedIds: string[];
  selectedItems: MyStoreItem[];
  connections: ChannelConnectionSummary[];
  onClear: () => void;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [panel, setPanel] = useState<"edit" | "publish" | null>(null);
  const [priceChangePercent, setPriceChangePercent] = useState("");
  const [quantityAdjust, setQuantityAdjust] = useState("");
  const [syncAfterEdit, setSyncAfterEdit] = useState(true);
  const [publishProviders, setPublishProviders] = useState<string[]>([]);
  const [categorySteps, setCategorySteps] = useState<ReturnType<typeof buildListOnCategoryQueue> | null>(
    null
  );

  const readyProviders = publishReadyConnections(connections);
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
      if (result.failed > 0) alert(`Ended ${result.updated}. ${result.failed} failed.`);
      onDone();
      onClear();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Bulk end failed");
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
      alert(`Relisted ${result.relisted ?? selectedIds.length} item(s).`);
      onDone();
      onClear();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Bulk relist failed");
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
      alert(e instanceof Error ? e.message : "Bulk delete failed");
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
      alert(`Unpublished ${result.unpublished}. ${result.failed ? `${result.failed} failed.` : ""}`.trim());
      onDone();
      onClear();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Bulk unpublish failed");
    } finally {
      setLoading(false);
    }
  }

  async function applyEdit() {
    if (!priceChangePercent && !quantityAdjust) {
      alert("Enter a price change percent and/or quantity adjustment.");
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
      if (result.failed > 0) alert(`Updated ${result.updated}. ${result.failed} failed.`);
      setPanel(null);
      setPriceChangePercent("");
      setQuantityAdjust("");
      onDone();
      onClear();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Bulk edit failed");
    } finally {
      setLoading(false);
    }
  }

  async function applyPublish(assignments?: ListOnCategoryAssignment[]) {
    if (publishProviders.length === 0) {
      alert("Select at least one channel.");
      return;
    }
    const queue = buildListOnCategoryQueue(selectedItems, publishProviders);
    if (!assignments && queue.length > 0) {
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
            providers: publishProviders,
            validateFirst: true,
            skipInvalid: true,
            ...(assignments?.length ? { assignments } : {}),
          }),
        }
      );
      alert(
        [
          `Published: ${result.published}`,
          result.failed ? `Failed: ${result.failed}` : null,
          result.skipped ? `Skipped: ${result.skipped}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      );
      setPanel(null);
      setCategorySteps(null);
      setPublishProviders([]);
      onDone();
      onClear();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Bulk publish failed";
      alert(msg);
      if (assignments) throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }

  const actionBtn =
    "text-sm font-semibold px-3 py-1.5 rounded-full border hover:bg-[var(--color-section-alt)] disabled:opacity-50";

  return (
    <>
      <div
        className="fixed bottom-0 inset-x-0 z-40 border-t bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="max-w-[var(--max-width)] xl:max-w-[1520px] mx-auto flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold mr-2" style={{ color: "var(--color-heading)" }}>
            {selectedIds.length} selected
          </span>
          {tab === "active" && (
            <>
              <button type="button" className={actionBtn} disabled={loading} onClick={() => void bulkEnd()}>
                End
              </button>
              <button type="button" className={actionBtn} disabled={loading} onClick={() => setPanel("edit")}>
                Price / qty
              </button>
              {readyProviders.length > 0 && (
                <button type="button" className={actionBtn} disabled={loading} onClick={() => setPanel("publish")}>
                  Publish
                </button>
              )}
              <button type="button" className={actionBtn} disabled={loading} onClick={() => void bulkUnpublish()}>
                Unpublish
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
            className={`${actionBtn} text-red-700 border-red-200`}
            disabled={loading}
            onClick={() => void bulkDelete()}
          >
            Delete
          </button>
          <button type="button" className="text-sm text-gray-600 px-2 py-1.5 ml-auto" disabled={loading} onClick={onClear}>
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
              Publish {selectedIds.length} items
            </h3>
            <div className="space-y-2 mb-4">
              {readyProviders.map((c) => (
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
                </label>
              ))}
              {readyProviders.length === 0 && (
                <p className="text-sm text-gray-600">No channels are ready to publish. Check Sync Stores.</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="text-sm px-3 py-2" onClick={() => setPanel(null)}>
                Cancel
              </button>
              <button type="button" className="btn text-sm" disabled={loading} onClick={() => void applyPublish()}>
                Publish
              </button>
            </div>
          </div>
        </div>
      )}

      {categorySteps && categorySteps.length > 0 ? (
        <ListOnChannelCategoryModal
          steps={categorySteps}
          onClose={() => setCategorySteps(null)}
          onComplete={(assignments) => applyPublish(assignments)}
        />
      ) : null}
    </>
  );
}
