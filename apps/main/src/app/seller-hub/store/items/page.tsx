"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";

type ItemsTab = "active" | "ended" | "sold";

type MyStoreItem = {
  id: string;
  title: string;
  slug: string;
  priceCents: number;
  quantity: number;
  status: string;
  photos: string[];
  soldOrderId?: string;
  soldAt?: string;
};

const ITEMS_TABS: { key: ItemsTab; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "ended", label: "Ended" },
  { key: "sold", label: "Sold" },
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

export default function MyItemsPage() {
  const [tab, setTab] = useState<ItemsTab>("active");
  const [items, setItems] = useState<MyStoreItem[]>([]);
  const [counts, setCounts] = useState<{ active: number; ended: number; sold: number } | null>(
    null
  );
  const [connectStatus, setConnectStatus] = useState<{
    onboarded: boolean;
    chargesEnabled: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.title.toLowerCase().includes(q));
  }, [items, search]);

  return (
    <div className="w-full min-w-0 max-w-5xl mx-auto" data-testid="seller-hub-my-items">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-heading)]">My Items</h1>
          <p className="text-sm text-gray-600 mt-1">View and edit your storefront listings.</p>
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

      <div className="flex flex-wrap gap-2 mb-3" role="tablist" aria-label="Listing status">
        {ITEMS_TABS.map((t) => {
          const count =
            counts == null
              ? null
              : t.key === "active"
                ? counts.active
                : t.key === "ended"
                  ? counts.ended
                  : counts.sold;
          const selected = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border-2 transition ${
                selected
                  ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                  : "bg-white text-[var(--color-heading)] border-[var(--color-primary)]"
              }`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {count != null ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      <div className="mb-4">
        <label className="sr-only" htmlFor="my-items-search">
          Search items
        </label>
        <input
          id="my-items-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title"
          className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      {loading ? <p className="text-sm text-gray-600">Loading items…</p> : null}
      {fetchError ? <p className="text-sm text-red-700">{fetchError}</p> : null}

      {!loading && !fetchError && filtered.length === 0 ? (
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

      <ul className="space-y-3">
        {filtered.map((item) => {
          const photo = Array.isArray(item.photos) ? item.photos[0] : undefined;
          return (
            <li key={item.id}>
              <Link
                href={itemEditHref(item)}
                className="flex gap-3 p-3 rounded-[10px] border-2 border-[var(--color-primary)] hover:bg-[var(--color-section-alt)] transition"
              >
                <div className="w-16 h-16 rounded-lg bg-gray-100 overflow-hidden shrink-0">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <IonIcon name="image-outline" size={22} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[var(--color-heading)] truncate">
                    {item.title}
                  </div>
                  <div className="text-sm text-gray-600 mt-0.5">
                    {formatPrice(item.priceCents)}
                    {tab !== "sold" ? ` · Qty ${item.quantity}` : null}
                    {` · ${statusLabel(item)}`}
                  </div>
                  {tab === "sold" && item.soldAt ? (
                    <div className="text-xs text-gray-500 mt-0.5">
                      Sold on {new Date(item.soldAt).toLocaleDateString()}
                    </div>
                  ) : null}
                </div>
                <IonIcon
                  name="chevron-forward"
                  size={20}
                  className="text-gray-400 shrink-0 self-center"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
