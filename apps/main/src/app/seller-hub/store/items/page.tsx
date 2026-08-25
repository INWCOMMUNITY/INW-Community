"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ItemChannelSyncBadges } from "@/components/store-item/ItemChannelSyncBadges";
import { MyItemsRowMenu } from "@/components/store-item/MyItemsRowMenu";
import { MyItemsBulkBar } from "@/components/store-item/MyItemsBulkBar";
import { MyItemsQuantityHistoryModal } from "@/components/store-item/MyItemsQuantityHistoryModal";
import { ChannelActionResultModal, type ChannelActionResult } from "@/components/store-item/ChannelActionResultModal";
import {
  itemEditHref,
  itemListingHref,
  itemStatusLabel,
  type ItemsTab,
  type MyStoreItem,
} from "@/components/store-item/my-items-types";
import { IonIcon } from "@/components/IonIcon";
import {
  fetchChannelConnections,
  type ChannelConnectionSummary,
} from "@/lib/channel-connections-client";
import { CHANNEL_PROVIDER_LABELS, CHANNEL_PROVIDERS_UI } from "@/lib/channels/provider-ui";

const ITEMS_TABS: { key: ItemsTab; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "ended", label: "Ended" },
  { key: "sold", label: "Sold" },
];

type FilterKey = "all" | "attention" | string;

export default function MyItemsPage() {
  const [tab, setTab] = useState<ItemsTab>("active");
  const [items, setItems] = useState<MyStoreItem[]>([]);
  const [counts, setCounts] = useState<{ active: number; ended: number; sold: number } | null>(null);
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

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setFetchError(null);
    const filterParam = tab === "active" ? "&filter=active" : tab === "ended" ? "&filter=ended" : "&filter=sold";
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
        setCounts({ active: countsData.active, ended: countsData.ended, sold: countsData.sold });
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
    void fetch("/api/channels/sync-on-view", { method: "POST", credentials: "include" }).catch(() => {});
  }, []);

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
    const fromItems = new Set((items ?? []).flatMap((i) => (i.channelLinks ?? []).map((l) => l.provider)));
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
          (l) => Boolean(l.syncWarning) || l.syncStatus === "error"
        );
      }
      if (filter !== "all") {
        return (item.channelLinks ?? []).some((l) => l.provider === filter);
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
    <div className="w-full max-md:mx-auto max-md:max-w-[var(--max-width)]">
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
          : tab === "ended"
            ? "Ended listings (not live)."
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

      <MyItemsBulkBar
        tab={tab}
        selectedIds={selectedIds}
        selectedItems={items.filter((i) => selectedIds.includes(i.id))}
        connections={connections}
        onClear={() => setSelectedIds([])}
        onDone={() => void load({ silent: true })}
        onActionResult={setActionResult}
      />

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-gray-500 text-sm">No items yet. Add your first item to start selling.</p>
      ) : visibleItems.length === 0 ? (
        <p className="text-gray-500 text-sm">No items match this search.</p>
      ) : (
        <div className="grid gap-2 w-full">
          <div className="flex items-center gap-2 px-1 mb-2">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              aria-label="Select all visible items"
            />
            <span className="text-xs text-gray-500">Select all</span>
            {selectedIds.length > 0 && (
              <span className="text-xs font-semibold text-gray-700">
                · {selectedIds.length} selected
              </span>
            )}
          </div>
          {visibleItems.map((item) => {
            const statusLabel = itemStatusLabel(item, tab);
            const rowHref =
              tab === "sold" && item.soldOrderId
                ? `/seller-hub/orders/${item.soldOrderId}`
                : itemListingHref(item);
            return (
              <div
                key={item.id}
                className="border rounded-lg overflow-hidden flex flex-col hover:bg-gray-50 w-full min-w-0"
              >
                <div className="p-3 flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="shrink-0"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    aria-label={`Select ${item.title}`}
                  />
                  <Link href={rowHref} className="relative shrink-0 no-underline">
                    {item.photos[0] ? (
                      <img src={item.photos[0]} alt="" className="w-12 h-12 object-cover rounded" />
                    ) : (
                      <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center text-gray-400 text-xs">
                        No photo
                      </div>
                    )}
                    {tab === "sold" && (
                      <span className="absolute inset-0 flex items-center justify-center rounded bg-red-600/90 text-white text-[10px] font-bold uppercase tracking-wide">
                        Sold
                      </span>
                    )}
                  </Link>
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <Link href={rowHref} className="font-medium truncate block no-underline hover:underline" style={{ color: "var(--color-heading)" }}>
                      {item.title}
                    </Link>
                    <p className="text-xs text-gray-600">
                      ${(item.priceCents / 100).toFixed(2)}
                      {tab === "sold" && item.soldAt
                        ? ` · Sold on ${new Date(item.soldAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
                        : ` · ${item.quantity} in stock · ${statusLabel}`}
                    </p>
                    {tab !== "sold" && item.channelLinks?.length ? (
                      <ItemChannelSyncBadges links={item.channelLinks} storeItemId={item.id} compact />
                    ) : null}
                  </div>
                  <Link href={itemEditHref(item)} className="btn text-sm shrink-0">
                    Edit
                  </Link>
                  {tab === "sold" && item.soldOrderId && (
                    <Link href={`/seller-hub/orders/${item.soldOrderId}`} className="text-sm font-semibold shrink-0 no-underline hover:underline" style={{ color: "var(--color-primary)" }}>
                      View order
                    </Link>
                  )}
                  <button
                    type="button"
                    className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center hover:bg-gray-100"
                    aria-label={`More actions for ${item.title}`}
                    onClick={() => setMenuItemId(item.id)}
                  >
                    <IonIcon name="ellipsis-vertical" size={20} />
                  </button>
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
