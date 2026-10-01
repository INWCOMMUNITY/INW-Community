"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { IonIcon } from "@/components/IonIcon";

type ItemsTab = "active" | "ended" | "sold" | "drafts";

type MyStoreItem = {
  id: string;
  title: string;
  slug: string;
  sku?: string | null;
  priceCents: number;
  quantity: number;
  status: string;
  photos: string[];
  views30d?: number;
  soldOrderId?: string;
  soldAt?: string;
};

const ITEMS_TABS: { key: ItemsTab; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "ended", label: "Ended" },
  { key: "sold", label: "Sold" },
  { key: "drafts", label: "Drafts" },
];

function formatPrice(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

function statusLabel(item: MyStoreItem): string {
  if (item.status === "sold_out") return "Sold";
  if (item.status === "inactive") return "Ended";
  if (item.quantity <= 0) return "Out of stock";
  return "Active";
}

function itemEditHref(item: MyStoreItem): string {
  return `/seller-hub/store/${item.id}`;
}

function MyItemsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = ((): ItemsTab => {
    const t = searchParams.get("tab");
    if (t === "sold" || t === "ended" || t === "drafts" || t === "active") return t;
    return "active";
  })();

  const [tab, setTab] = useState<ItemsTab>(initialTab);
  const [items, setItems] = useState<MyStoreItem[]>([]);
  const [counts, setCounts] = useState<{
    active: number;
    ended: number;
    sold: number;
  } | null>(null);
  const [connectStatus, setConnectStatus] = useState<{
    onboarded: boolean;
    chargesEnabled: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [acting, setActing] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkQty, setBulkQty] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "sold" || t === "ended" || t === "drafts" || t === "active") {
      setTab(t);
    }
  }, [searchParams]);

  const setTabAndUrl = (next: ItemsTab) => {
    setTab(next);
    setSelectedIds([]);
    setMenuOpenId(null);
    const url = next === "active" ? "/seller-hub/store/items" : `/seller-hub/store/items?tab=${next}`;
    router.replace(url);
  };

  const load = useCallback(async () => {
    if (tab === "drafts") {
      setLoading(false);
      setItems([]);
      setFetchError(null);
      try {
        const [statusRes, countsRes] = await Promise.all([
          fetch("/api/stripe/connect/status", { credentials: "include" }),
          fetch("/api/store-items?mine=1&counts=1", { credentials: "include" }),
        ]);
        const statusData = await statusRes.json().catch(() => ({}));
        const countsData = await countsRes.json().catch(() => ({}));
        if (countsRes.ok && countsData && typeof countsData.active === "number") {
          setCounts({
            active: countsData.active,
            ended: Number(countsData.ended) || 0,
            sold: Number(countsData.sold) || 0,
          });
        }
        if (statusRes.ok && statusData && typeof statusData.chargesEnabled === "boolean") {
          setConnectStatus({
            onboarded: Boolean(statusData.onboarded),
            chargesEnabled: Boolean(statusData.chargesEnabled),
          });
        }
      } catch {
        /* ignore */
      }
      return;
    }

    setLoading(true);
    setFetchError(null);
    const filterParam =
      tab === "active" ? "&filter=active" : tab === "ended" ? "&filter=ended" : "&filter=sold";
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
          ended: Number(countsData.ended) || 0,
          sold: Number(countsData.sold) || 0,
        });
      }

      if (statusRes.ok && statusData && typeof statusData.chargesEnabled === "boolean") {
        setConnectStatus({
          onboarded: Boolean(statusData.onboarded),
          chargesEnabled: Boolean(statusData.chargesEnabled),
        });
      } else {
        setConnectStatus(null);
      }
    } catch {
      setFetchError("Connection failed. Please try again.");
      setItems([]);
      setConnectStatus(null);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => items.some((i) => i.id === id)));
  }, [items]);

  useEffect(() => {
    if (!menuOpenId) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(`[data-item-menu="${menuOpenId}"]`)) return;
      setMenuOpenId(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpenId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.sku ?? "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((i) => selectedIds.includes(i.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      const visible = new Set(filtered.map((i) => i.id));
      setSelectedIds((prev) => prev.filter((id) => !visible.has(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...filtered.map((i) => i.id)])));
    }
  };

  const runAction = async (fn: () => Promise<void>, successMsg: string) => {
    setActing(true);
    setActionMessage(null);
    try {
      await fn();
      setActionMessage(successMsg);
      setSelectedIds([]);
      setMenuOpenId(null);
      await load();
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setActing(false);
    }
  };

  const bulkPatch = async (ids: string[], updates: Record<string, unknown>) => {
    const res = await fetch("/api/store-items/bulk", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeItemIds: ids, updates }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? "Bulk update failed");
  };

  const endListings = (ids: string[]) => {
    if (!confirm(`End ${ids.length} listing${ids.length === 1 ? "" : "s"}?`)) return;
    void runAction(async () => {
      if (ids.length === 1) {
        const res = await fetch(`/api/store-items/${ids[0]}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "inactive" }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error ?? "Failed to end listing");
        }
      } else {
        const res = await fetch("/api/store-items/bulk", {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storeItemIds: ids }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error ?? "Failed to end listings");
        }
      }
    }, "Listing(s) ended.");
  };

  const markSold = (ids: string[]) => {
    void runAction(async () => {
      await bulkPatch(ids, { status: "sold_out" });
    }, "Marked as sold.");
  };

  const relist = (ids: string[]) => {
    if (!confirm(`Relist ${ids.length} item${ids.length === 1 ? "" : "s"} with quantity 1?`)) return;
    void runAction(async () => {
      const res = await fetch("/api/store-items/bulk-relist", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemIds: ids, quantity: 1 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed to relist");
    }, "Relisted successfully.");
  };

  const shareToFeed = (ids: string[]) => {
    void runAction(async () => {
      const res = await fetch("/api/store-items/share-to-feed", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemIds: ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed to share");
    }, "Shared to feed.");
  };

  const applyBulkEdit = () => {
    const updates: { priceCents?: number; quantity?: number } = {};
    const price = parseFloat(bulkPrice);
    const qty = parseInt(bulkQty, 10);
    if (bulkPrice.trim() && !Number.isNaN(price) && price > 0) {
      updates.priceCents = Math.round(price * 100);
    }
    if (bulkQty.trim() && !Number.isNaN(qty) && qty >= 0) {
      updates.quantity = qty;
    }
    if (!updates.priceCents && updates.quantity === undefined) {
      setFetchError("Enter a price and/or quantity to update.");
      return;
    }
    void runAction(async () => {
      await bulkPatch(selectedIds, updates);
      setBulkEditOpen(false);
      setBulkPrice("");
      setBulkQty("");
    }, "Selected listings updated.");
  };

  const showBulkBar = tab !== "drafts" && selectedIds.length > 0;

  return (
    <div className="w-full min-w-0 max-w-5xl mx-auto" data-testid="seller-hub-my-items">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-heading)]">My Items</h1>
          <p className="text-sm text-gray-500 mt-1">
            Select items to bulk edit, or use Edit / View on each row.
          </p>
        </div>
        <Link href="/seller-hub/store/new" className="btn shrink-0">
          List an item
        </Link>
      </div>

      {connectStatus && !connectStatus.chargesEnabled ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          Complete Stripe payout setup to sell.{" "}
          <Link href="/seller-hub/store/payouts" className="font-semibold underline">
            Get Paid
          </Link>
        </div>
      ) : null}

      {actionMessage ? (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {actionMessage}
        </div>
      ) : null}

      <div
        className="mb-4 flex flex-wrap gap-1 border-b border-gray-200"
        role="tablist"
        aria-label="Listing status"
      >
        {ITEMS_TABS.map((t) => {
          const count =
            counts == null
              ? null
              : t.key === "active"
                ? counts.active
                : t.key === "ended"
                  ? counts.ended
                  : t.key === "sold"
                    ? counts.sold
                    : null;
          const selected = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`px-3 py-2.5 text-sm font-semibold border-b-2 -mb-px transition ${
                selected
                  ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                  : "border-transparent text-gray-500 hover:text-[var(--color-heading)]"
              }`}
              onClick={() => setTabAndUrl(t.key)}
            >
              {t.label}
              {count != null ? (
                <span className={`ml-1.5 tabular-nums ${selected ? "opacity-90" : "text-gray-400"}`}>
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="my-items-search">
          Search items
        </label>
        <input
          id="my-items-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title or SKU"
          className="w-full max-w-md rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm"
          disabled={tab === "drafts"}
        />
        {tab !== "drafts" && filtered.length > 0 ? (
          <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              className="rounded border-gray-300"
            />
            Select all
            {selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
          </label>
        ) : null}
      </div>

      {showBulkBar ? (
        <div className="mb-4 sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--color-heading)] text-white px-3 py-2.5 shadow-md">
          <span className="text-xs font-semibold mr-1">{selectedIds.length} selected</span>
          {(tab === "ended" || tab === "sold") && (
            <button
              type="button"
              disabled={acting}
              className="rounded-md bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25 disabled:opacity-50"
              onClick={() => relist(selectedIds)}
            >
              Relist
            </button>
          )}
          {tab === "active" && (
            <>
              <button
                type="button"
                disabled={acting}
                className="rounded-md bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25 disabled:opacity-50"
                onClick={() => {
                  setBulkPrice("");
                  setBulkQty("");
                  setBulkEditOpen(true);
                }}
              >
                Edit price/qty
              </button>
              <button
                type="button"
                disabled={acting}
                className="rounded-md bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25 disabled:opacity-50"
                onClick={() => endListings(selectedIds)}
              >
                End
              </button>
              <button
                type="button"
                disabled={acting}
                className="rounded-md bg-emerald-500/30 px-3 py-1.5 text-xs font-bold text-emerald-100 hover:bg-emerald-500/40 disabled:opacity-50"
                onClick={() => markSold(selectedIds)}
              >
                Mark sold
              </button>
              <button
                type="button"
                disabled={acting}
                className="rounded-md bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25 disabled:opacity-50"
                onClick={() => shareToFeed(selectedIds)}
              >
                Share to feed
              </button>
            </>
          )}
          {selectedIds.length === 1 ? (
            <Link
              href={`/seller-hub/store/new?similar=${selectedIds[0]}`}
              className="rounded-md bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25"
            >
              Sell similar
            </Link>
          ) : null}
        </div>
      ) : null}

      {bulkEditOpen ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-[var(--color-heading)] mb-1">
            Edit {selectedIds.length} listings
          </h2>
          <p className="text-xs text-gray-500 mb-3">Leave a field blank to keep its current value.</p>
          <div className="flex flex-wrap gap-3 items-end">
            <label className="text-sm">
              <span className="block text-gray-600 mb-1">Price ($)</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={bulkPrice}
                onChange={(e) => setBulkPrice(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 w-32"
                placeholder="24.99"
              />
            </label>
            <label className="text-sm">
              <span className="block text-gray-600 mb-1">Quantity</span>
              <input
                type="number"
                min="0"
                step="1"
                value={bulkQty}
                onChange={(e) => setBulkQty(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 w-28"
                placeholder="3"
              />
            </label>
            <button type="button" className="btn" disabled={acting} onClick={applyBulkEdit}>
              Apply
            </button>
            <button
              type="button"
              className="text-sm text-gray-600 underline"
              onClick={() => setBulkEditOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {loading ? <p className="text-sm text-gray-600">Loading items…</p> : null}
      {fetchError ? <p className="text-sm text-red-700">{fetchError}</p> : null}

      {tab === "drafts" && !loading ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center">
          <p className="text-sm text-gray-700 mb-2 font-semibold">Drafts live in the mobile app</p>
          <p className="text-sm text-gray-600 mb-4">
            Save unfinished listings on iOS/Android, then resume them from My Items → Drafts.
          </p>
          <Link href="/seller-hub/store/new" className="btn">
            Start a new listing
          </Link>
        </div>
      ) : null}

      {!loading && !fetchError && tab !== "drafts" && filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center">
          <p className="text-sm text-gray-700 mb-3">
            {tab === "active"
              ? "No active listings yet."
              : tab === "ended"
                ? "No ended listings."
                : "No sold listings yet."}
          </p>
          {tab === "active" ? (
            <Link href="/seller-hub/store/new" className="btn">
              Create your first listing
            </Link>
          ) : null}
        </div>
      ) : null}

      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white overflow-hidden">
        {filtered.map((item) => {
          const photo = Array.isArray(item.photos) ? item.photos[0] : undefined;
          const selected = selectedIds.includes(item.id);
          const views = item.views30d ?? 0;
          const status = statusLabel(item);
          return (
            <li
              key={item.id}
              className={`relative ${selected ? "bg-[var(--color-section-alt)]" : "bg-white"}`}
              data-item-menu={item.id}
            >
              <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
                <label className="flex items-center cursor-pointer shrink-0 self-stretch">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSelect(item.id)}
                    className="rounded border-gray-300"
                    aria-label={`Select ${item.title}`}
                  />
                </label>

                <div className="w-14 h-14 rounded-md bg-gray-100 overflow-hidden shrink-0 border border-gray-100">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                      <IonIcon name="image-outline" size={20} />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[var(--color-heading)] leading-snug line-clamp-2">
                    {item.title}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600">
                    <span className="font-semibold text-[var(--color-heading)]">
                      {formatPrice(item.priceCents)}
                    </span>
                    {tab !== "sold" ? <span className="text-gray-300">·</span> : null}
                    {tab !== "sold" ? <span>Qty {item.quantity}</span> : null}
                    <span className="text-gray-300">·</span>
                    <span
                      className={
                        status === "Active"
                          ? "text-emerald-700 font-medium"
                          : status === "Out of stock"
                            ? "text-amber-700 font-medium"
                            : "text-gray-500 font-medium"
                      }
                    >
                      {status}
                    </span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-500">
                      {views} view{views === 1 ? "" : "s"} (30d)
                    </span>
                  </div>
                  {tab === "sold" && item.soldAt ? (
                    <div className="text-xs text-gray-500 mt-1">
                      Sold on {new Date(item.soldAt).toLocaleDateString()}
                    </div>
                  ) : null}

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <Link
                      href={itemEditHref(item)}
                      className="font-semibold text-[var(--color-primary)] hover:underline"
                    >
                      Edit
                    </Link>
                    {item.slug ? (
                      <Link
                        href={`/storefront/${item.slug}?from=my-items`}
                        className="font-medium text-gray-600 hover:underline"
                      >
                        View
                      </Link>
                    ) : null}
                    {(tab === "ended" || tab === "sold") && (
                      <button
                        type="button"
                        disabled={acting}
                        className="font-semibold text-emerald-700 hover:underline disabled:opacity-50"
                        onClick={() => relist([item.id])}
                      >
                        Relist
                      </button>
                    )}
                    <Link
                      href={`/seller-hub/store/new?similar=${item.id}`}
                      className="font-medium text-gray-600 hover:underline"
                    >
                      Sell similar
                    </Link>
                  </div>
                </div>

                <button
                  type="button"
                  className="p-2 rounded-md text-gray-400 hover:text-[var(--color-heading)] hover:bg-gray-100 shrink-0"
                  aria-label="More actions"
                  aria-expanded={menuOpenId === item.id}
                  onClick={() => setMenuOpenId(menuOpenId === item.id ? null : item.id)}
                >
                  <IonIcon name="ellipsis-vertical" size={18} />
                </button>
              </div>

              {menuOpenId === item.id ? (
                <div className="absolute right-3 top-12 z-20 min-w-[180px] rounded-lg border border-gray-200 bg-white shadow-lg py-1">
                  <Link
                    href={itemEditHref(item)}
                    className="block px-3 py-2 text-sm hover:bg-gray-50 font-medium"
                  >
                    Edit listing
                  </Link>
                  <Link
                    href={`/seller-hub/store/new?similar=${item.id}`}
                    className="block px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    Sell similar
                  </Link>
                  {item.slug ? (
                    <Link
                      href={`/storefront/${item.slug}?from=my-items`}
                      className="block px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      View listing
                    </Link>
                  ) : null}
                  {tab === "sold" && item.soldOrderId ? (
                    <Link
                      href={`/seller-hub/orders/${item.soldOrderId}`}
                      className="block px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      View order
                    </Link>
                  ) : null}
                  {(tab === "ended" || tab === "sold") && (
                    <button
                      type="button"
                      className="block w-full text-left px-3 py-2 text-sm text-emerald-700 font-semibold hover:bg-gray-50"
                      onClick={() => relist([item.id])}
                    >
                      Relist
                    </button>
                  )}
                  {tab !== "sold" && (
                    <button
                      type="button"
                      className="block w-full text-left px-3 py-2 text-sm text-emerald-700 font-semibold hover:bg-gray-50"
                      onClick={() => markSold([item.id])}
                    >
                      Mark sold
                    </button>
                  )}
                  {tab === "active" && (
                    <button
                      type="button"
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      onClick={() => endListings([item.id])}
                    >
                      End listing
                    </button>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function MyItemsPage() {
  return (
    <Suspense fallback={<p className="p-8 text-gray-500 text-center">Loading My Items…</p>}>
      <MyItemsPageInner />
    </Suspense>
  );
}
