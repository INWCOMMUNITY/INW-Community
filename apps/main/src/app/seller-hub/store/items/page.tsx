"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import Link from "next/link";
import { ItemChannelSyncBadges } from "@/components/store-item/ItemChannelSyncBadges";
import { MyItemsRowMenu } from "@/components/store-item/MyItemsRowMenu";
import { MyItemsBulkBar } from "@/components/store-item/MyItemsBulkBar";
import { MyItemsQuantityHistoryModal } from "@/components/store-item/MyItemsQuantityHistoryModal";
import { ChannelActionResultModal, type ChannelActionResult } from "@/components/store-item/ChannelActionResultModal";
import {
  itemEditHref,
  itemListingHref,
  itemOtherLiveProviders,
  itemRemoteDeletedProvider,
  itemStatusLabel,
  type ItemsTab,
  type MyStoreItem,
} from "@/components/store-item/my-items-types";
import { formatRemoteDeletedMessage } from "@/lib/channels/remote-deleted-copy";
import { IonIcon } from "@/components/IonIcon";
import {
  fetchChannelConnections,
  type ChannelConnectionSummary,
} from "@/lib/channel-connections-client";
import { CHANNEL_PROVIDER_LABELS, CHANNEL_PROVIDERS_UI } from "@/lib/channels/provider-ui";

const ITEMS_TABS: { key: ItemsTab; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "attention", label: "Needs Attention" },
  { key: "ended", label: "Ended" },
  { key: "sold", label: "Sold" },
];

function stopRowClick(e: MouseEvent) {
  e.stopPropagation();
}

function RemoteDeletedDecision({
  item,
  busy,
  onKeep,
  onDelete,
}: {
  item: MyStoreItem;
  busy: boolean;
  onKeep: () => void;
  onDelete: () => void;
}) {
  const deletedProvider = itemRemoteDeletedProvider(item);
  if (!deletedProvider) return null;
  const copy = formatRemoteDeletedMessage({
    deletedProvider,
    otherProviders: itemOtherLiveProviders(item, deletedProvider),
  });
  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3" onClick={stopRowClick}>
      <p className="text-sm font-semibold text-amber-950">{copy.headline}</p>
      <p className="text-xs text-amber-900 mt-0.5">{copy.body}</p>
      <div className="flex flex-wrap gap-2 mt-2">
        <button type="button" className="btn text-xs" disabled={busy} onClick={onDelete}>
          {busy ? "Working…" : "Delete everywhere"}
        </button>
        <button
          type="button"
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border-2 bg-white"
          style={{ borderColor: "var(--color-primary)", color: "var(--color-heading)" }}
          disabled={busy}
          onClick={onKeep}
        >
          Keep on INW and other shops
        </button>
      </div>
    </div>
  );
}

type FilterKey = "all" | "attention" | string;

export default function MyItemsPage() {
  const [tab, setTab] = useState<ItemsTab>("active");
  const [items, setItems] = useState<MyStoreItem[]>([]);
  const [counts, setCounts] = useState<{
    active: number;
    attention: number;
    ended: number;
    sold: number;
  } | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [connections, setConnections] = useState<ChannelConnectionSummary[]>([]);
  const [connectStatus, setConnectStatus] = useState<{
    onboarded: boolean;
    chargesEnabled: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
  const [historyItemId, setHistoryItemId] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<ChannelActionResult | null>(null);
  const [syncTick, setSyncTick] = useState(0);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setFetchError(null);
    const filterParam =
      tab === "active"
        ? "&filter=active"
        : tab === "attention"
          ? "&filter=attention"
          : tab === "ended"
            ? "&filter=ended"
            : "&filter=sold";
    try {
      const [itemsRes, statusRes, countsRes] = await Promise.all([
        fetch(`/api/store-items?mine=1${filterParam}`, { credentials: "include" }),
        fetch("/api/stripe/connect/status", { credentials: "include" }),
        fetch("/api/store-items?mine=1&counts=1", { credentials: "include" }),
      ]);
      const itemsData = await itemsRes.json().catch(() => ({}));
      const statusData = await statusRes.json().catch(() => ({}));
      const countsData = await countsRes.json().catch(() => ({}));

      if (!itemsRes.ok) {
        const msg =
          itemsRes.status === 401
            ? "Please sign in to view your items."
            : itemsRes.status === 403
              ? (itemsData as { error?: string }).error ?? "Seller plan required."
              : (itemsData as { error?: string }).error ?? "Failed to load items.";
        setFetchError(msg);
        setItems([]);
      } else {
        setItems(Array.isArray(itemsData) ? itemsData : []);
      }

      if (countsRes.ok && countsData && typeof countsData.active === "number") {
        setCounts({
          active: countsData.active,
          attention: typeof countsData.attention === "number" ? countsData.attention : 0,
          ended: countsData.ended,
          sold: countsData.sold,
        });
      }

      if (!statusRes.ok) {
        if (!itemsRes.ok) {
          setConnectStatus(null);
        } else {
          const msg =
            statusRes.status === 401
              ? "Please sign in to check payment setup."
              : (statusData as { error?: string }).error ?? "Failed to load payment status.";
          setFetchError(msg);
          setConnectStatus(null);
        }
      } else {
        setConnectStatus(statusData);
      }
    } catch {
      setItems([]);
      setConnectStatus(null);
      setFetchError("Connection failed. Make sure the server is running and PostgreSQL is started.");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedIds([]);
    setFilter("all");
  }, [tab]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => items.some((i) => i.id === id)));
  }, [items]);

  useEffect(() => {
    void fetchChannelConnections().then(setConnections).catch(() => setConnections([]));
    void fetch("/api/channels/sync-on-view", { method: "POST", credentials: "include" })
      .then(() => setSyncTick((n) => n + 1))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (syncTick === 0) return;
    void load({ silent: true });
  }, [syncTick, load]);

  async function handleRemoteDeleteDecision(itemId: string, action: "keep" | "delete_everywhere") {
    const item = items.find((row) => row.id === itemId);
    const deletedProvider = item ? itemRemoteDeletedProvider(item) : null;
    const others = item && deletedProvider ? itemOtherLiveProviders(item, deletedProvider) : [];
    const shopNames = others.map((p) => CHANNEL_PROVIDER_LABELS[p] ?? p);
    if (action === "delete_everywhere") {
      const extra = shopNames.length > 0 ? ` and on ${shopNames.join(", ")}` : "";
      if (!window.confirm(`Delete this listing on INW${extra}? This cannot be undone.`)) return;
    }
    setDecidingId(itemId);
    try {
      const res = await fetch(`/api/store-items/${itemId}/remote-delete-decision`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setFetchError(data.error ?? "Could not save that choice.");
        return;
      }
      await load({ silent: true });
    } catch {
      setFetchError("Could not save that choice.");
    } finally {
      setDecidingId(null);
    }
  }

  async function handleOnboard() {
    const res = await fetch("/api/stripe/connect/onboard", { method: "POST", credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (data.url) {
      window.location.href = data.url;
    } else {
      setFetchError(data.error ?? "Payment setup failed. Check Stripe configuration in .env");
    }
  }

  const providerFilters = useMemo(() => {
    const fromItems = new Set(
      (items ?? []).flatMap((i) =>
        (i.channelLinks ?? []).filter((l) => !l.remoteDeletedProvider).map((l) => l.provider)
      )
    );
    const fromConnections = connections.map((c) => c.provider);
    return CHANNEL_PROVIDERS_UI.map((p) => p.provider).filter(
      (p) => fromItems.has(p) || fromConnections.includes(p)
    );
  }, [items, connections]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (q && !item.title.toLowerCase().includes(q)) return false;
      if (filter === "attention") {
        return (item.channelLinks ?? []).some(
          (l) =>
            Boolean(l.remoteDeletedProvider) ||
            Boolean(l.syncWarning) ||
            l.syncStatus === "error"
        );
      }
      if (filter !== "all") {
        return (item.channelLinks ?? []).some(
          (l) => l.provider === filter && !l.remoteDeletedProvider
        );
      }
      return true;
    });
  }, [items, search, filter]);

  const allVisibleSelected =
    visibleItems.length > 0 && visibleItems.every((i) => selectedIds.includes(i.id));

  function toggleSelect(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectAll() {
    if (allVisibleSelected) {
      const visible = new Set(visibleItems.map((i) => i.id));
      setSelectedIds((prev) => prev.filter((id) => !visible.has(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleItems.map((i) => i.id)])));
    }
  }

  const menuItem = menuItemId ? items.find((i) => i.id === menuItemId) ?? null : null;
  const historyItem = historyItemId ? items.find((i) => i.id === historyItemId) ?? null : null;
  const countFor = (key: ItemsTab) => (counts ? counts[key] : null);

  const chipClass = (active: boolean) =>
    `text-xs font-semibold rounded-full px-3 py-1.5 border ${
      active
        ? "text-white border-transparent"
        : "text-gray-700 border-gray-200 hover:bg-gray-50"
    }`;

  return (
    <div
      className={`w-full max-md:mx-auto max-md:max-w-[var(--max-width)] ${
        selectedIds.length > 0 ? "pb-48" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-xl font-bold" style={{ color: "var(--color-heading)" }}>
          My Items
        </h2>
        <Link href="/seller-hub/store/new" className="btn text-sm shrink-0">
          List an item
        </Link>
      </div>

      {fetchError && (
        <div className="border rounded-lg p-4 bg-red-50 mb-6">
          <p className="text-red-700 text-sm">{fetchError}</p>
          {fetchError.includes("sign in") && (
            <Link href="/login?callbackUrl=/seller-hub/store/items" className="btn mt-3 text-sm">
              Sign in
            </Link>
          )}
        </div>
      )}
      {connectStatus && (!connectStatus.onboarded || !connectStatus.chargesEnabled) && (
        <div className="border rounded-lg p-4 bg-amber-50 mb-6">
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <IonIcon name="wallet-outline" size={20} className="shrink-0" />
            Complete Payment Setup
          </h3>
          <p className="text-sm text-gray-600 mb-3">
            Items are only listed on the store once payment setup is complete. Complete Stripe Connect onboarding to list items and receive payments.
          </p>
          <button
            type="button"
            onClick={handleOnboard}
            className="btn text-sm"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
          >
            <IonIcon name="wallet-outline" size={18} className="text-white shrink-0" />
            Complete Payment Setup
          </button>
        </div>
      )}

      <div className="flex gap-2 mb-3 border-b border-gray-200">
        {ITEMS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.key
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            {t.label}
            {countFor(t.key) != null && (
              <span className="ml-1.5 text-xs font-semibold text-gray-500">{countFor(t.key)}</span>
            )}
          </button>
        ))}
      </div>
      <p className="text-gray-600 text-sm mb-3">
        {tab === "active"
          ? "Live on the storefront, including out of stock."
          : tab === "attention"
            ? "A connected shop deleted this listing. Choose whether to delete it on INW and your other shops too."
            : tab === "ended"
              ? "Ended listings are not live on INW. They are removed from INW 14 days after they are ended. Other shops stay up."
              : "Items you've sold."}
      </p>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search titles"
          className="w-full sm:max-w-xs border rounded-lg px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={chipClass(filter === "all")}
            style={filter === "all" ? { backgroundColor: "var(--color-primary)" } : undefined}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            className={chipClass(filter === "attention")}
            style={filter === "attention" ? { backgroundColor: "var(--color-primary)" } : undefined}
            onClick={() => setFilter("attention")}
          >
            Needs attention
          </button>
          {providerFilters.map((p) => (
            <button
              key={p}
              type="button"
              className={chipClass(filter === p)}
              style={filter === p ? { backgroundColor: "var(--color-primary)" } : undefined}
              onClick={() => setFilter(p)}
            >
              {CHANNEL_PROVIDER_LABELS[p] ?? p}
            </button>
          ))}
        </div>
      </div>

      {tab !== "attention" ? (
        <MyItemsBulkBar
          tab={tab}
          selectedIds={selectedIds}
          selectedItems={items.filter((i) => selectedIds.includes(i.id))}
          connections={connections}
          onClear={() => setSelectedIds([])}
          onDone={() => void load({ silent: true })}
          onActionResult={setActionResult}
        />
      ) : null}

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-gray-500 text-sm">
          {tab === "attention"
            ? "Nothing needs attention. When a listing is deleted on eBay, Etsy, or another connected shop, it shows up here."
            : "No items yet. Add your first item to start selling."}
        </p>
      ) : visibleItems.length === 0 ? (
        <p className="text-gray-500 text-sm">No items match this search.</p>
      ) : (
        <div className="grid gap-3 w-full">
          <div
            className="flex items-center gap-3 px-1 mb-1 cursor-pointer"
            onClick={toggleSelectAll}
          >
            <span className="flex h-10 w-10 items-center justify-center">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--color-primary)]"
                checked={allVisibleSelected}
                onClick={stopRowClick}
                onChange={toggleSelectAll}
                aria-label="Select all visible items"
              />
            </span>
            <span className="text-sm text-gray-600">Select all</span>
            {selectedIds.length > 0 && (
              <span className="text-sm font-semibold text-gray-700">
                · {selectedIds.length} selected
              </span>
            )}
          </div>
          {visibleItems.map((item) => {
            const statusLabel = itemStatusLabel(item, tab);
            const listingHref = itemListingHref(item);
            const selected = selectedIds.includes(item.id);
            return (
              <div
                key={item.id}
                className={`border-2 rounded-xl overflow-hidden flex flex-col w-full min-w-0 cursor-pointer ${
                  selected
                    ? "border-[var(--color-primary)] bg-[var(--color-section-alt)]"
                    : "border-gray-200 hover:bg-gray-50"
                }`}
                onClick={() => toggleSelect(item.id)}
              >
                <div className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center">
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-[var(--color-primary)]"
                        checked={selected}
                        onClick={stopRowClick}
                        onChange={() => toggleSelect(item.id)}
                        aria-label={`Select ${item.title}`}
                      />
                    </span>
                    <div className="relative shrink-0">
                      {item.photos[0] ? (
                        <img src={item.photos[0]} alt="" className="w-16 h-16 object-cover rounded-lg" />
                      ) : (
                        <div className="w-16 h-16 bg-gray-200 rounded-lg flex items-center justify-center text-gray-400 text-xs">
                          No photo
                        </div>
                      )}
                      {tab === "sold" && (
                        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-red-600/90 text-white text-[10px] font-bold uppercase tracking-wide">
                          Sold
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <Link
                        href={listingHref}
                        onClick={stopRowClick}
                        className="font-medium truncate block underline underline-offset-2 hover:opacity-80"
                        style={{ color: "var(--color-heading)" }}
                      >
                        {item.title}
                      </Link>
                      <p className="text-sm text-gray-600 mt-0.5">
                        ${(item.priceCents / 100).toFixed(2)}
                        {tab === "sold" && item.soldAt
                          ? ` · Sold on ${new Date(item.soldAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
                          : ` · ${item.quantity} in stock · ${statusLabel}`}
                      </p>
                      {tab !== "sold" && item.channelLinks?.length ? (
                        <div onClick={stopRowClick}>
                          <ItemChannelSyncBadges links={item.channelLinks} storeItemId={item.id} compact />
                        </div>
                      ) : null}
                      {tab === "attention" ? (
                        <RemoteDeletedDecision
                          item={item}
                          busy={decidingId === item.id}
                          onKeep={() => void handleRemoteDeleteDecision(item.id, "keep")}
                          onDelete={() => void handleRemoteDeleteDecision(item.id, "delete_everywhere")}
                        />
                      ) : null}
                    </div>
                  </div>
                  <div
                    className="flex items-center gap-2 shrink-0 pl-10 sm:pl-0"
                    onClick={stopRowClick}
                  >
                    <Link
                      href={listingHref}
                      className="text-sm font-semibold px-3 py-2 rounded-lg border-2 shrink-0 no-underline hover:bg-white"
                      style={{ borderColor: "var(--color-primary)", color: "var(--color-heading)" }}
                    >
                      View
                    </Link>
                    <Link href={itemEditHref(item)} className="btn text-sm shrink-0">
                      Edit
                    </Link>
                    {tab === "sold" && item.soldOrderId && (
                      <Link
                        href={`/seller-hub/orders/${item.soldOrderId}`}
                        className="text-sm font-semibold shrink-0 no-underline hover:underline"
                        style={{ color: "var(--color-primary)" }}
                      >
                        View order
                      </Link>
                    )}
                    <button
                      type="button"
                      className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-100"
                      aria-label={`More actions for ${item.title}`}
                      onClick={() => setMenuItemId(item.id)}
                    >
                      <IonIcon name="ellipsis-vertical" size={20} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {menuItem && (
        <MyItemsRowMenu
          item={menuItem}
          tab={tab}
          connections={connections}
          onClose={() => setMenuItemId(null)}
          onDone={() => void load({ silent: true })}
          onViewHistory={() => setHistoryItemId(menuItem.id)}
          onActionResult={setActionResult}
        />
      )}
      {actionResult ? (
        <ChannelActionResultModal result={actionResult} onClose={() => setActionResult(null)} />
      ) : null}
      {historyItem && (
        <MyItemsQuantityHistoryModal
          storeItemId={historyItem.id}
          title={historyItem.title}
          onClose={() => setHistoryItemId(null)}
        />
      )}
    </div>
  );
}
