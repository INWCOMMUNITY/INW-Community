"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppsAirportListedOnChannels } from "@/components/apps-airport/AppsAirportListedOnChannels";
import { IonIcon } from "@/components/IonIcon";
import { type AppsAirportChannelId } from "@/lib/shopify/apps-airport";
import { ShareListingsToFeedPrompt } from "@/components/feed/ShareListingsToFeedPrompt";

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
  /** Underlying listing id for sold sale rows (id may be sale:…). */
  storeItemId?: string;
  variantLabel?: string | null;
  soldQty?: number;
  soldChannel?: "inw" | "etsy";
  canRelist?: boolean;
  /** Where the listing is live — INW always; Shopify when linked. */
  channels?: AppsAirportChannelId[];
};

const STATUS_TABS: { key: Exclude<ItemsTab, "drafts">; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "ended", label: "Ended" },
  { key: "sold", label: "Sold" },
];

function formatPrice(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

function statusLabel(item: MyStoreItem): string {
  if (item.status === "draft") return "Draft";
  if (item.status === "sold_out") return "Sold";
  if (item.status === "inactive") return "Ended";
  if (item.quantity <= 0) return "Out of stock";
  return "Active";
}

function listingIdOf(item: MyStoreItem): string {
  return item.storeItemId || item.id;
}

function itemEditHref(item: MyStoreItem): string {
  return `/seller-hub/store/${listingIdOf(item)}`;
}

function itemTitleHref(item: MyStoreItem): string {
  if (item.status === "draft") return itemEditHref(item);
  return item.slug ? `/storefront/${item.slug}?from=my-items` : itemEditHref(item);
}

function statusChipClass(status: string): string {
  if (status === "Active") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  if (status === "Draft") {
    return "border-[#c99d5f] bg-[#FDEDCC] text-[#5d4f40]";
  }
  if (status === "Out of stock") {
    return "border-amber-300 bg-amber-100 text-amber-950";
  }
  if (status === "Sold") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  return "border-neutral-200 bg-neutral-50 text-neutral-700";
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
    drafts: number;
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
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [feedShareIds, setFeedShareIds] = useState<string[]>([]);

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
    setLoading(true);
    setFetchError(null);
    const filterParam =
      tab === "active"
        ? "&filter=active"
        : tab === "ended"
          ? "&filter=ended"
          : tab === "drafts"
            ? "&filter=drafts"
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
          ended: Number(countsData.ended) || 0,
          sold: Number(countsData.sold) || 0,
          drafts: Number(countsData.drafts) || 0,
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
        (item.sku ?? "").toLowerCase().includes(q) ||
        (item.variantLabel ?? "").toLowerCase().includes(q)
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

  const openShareToFeed = (ids: string[]) => {
    if (ids.length === 0) return;
    setMenuOpenId(null);
    setFeedShareIds(ids);
  };

  const summaryCounts = counts ?? { active: 0, ended: 0, sold: 0, drafts: 0 };
  const hasSelection = selectedIds.length > 0;

  const manageMenu = (item: MyStoreItem, align: "left" | "right" = "right") =>
    menuOpenId === item.id ? (
      <div
        className={`absolute ${align === "left" ? "left-0" : "right-0"} top-10 z-20 min-w-[180px] rounded-lg border border-neutral-200 bg-white shadow-lg py-1`}
      >
        <Link
          href={itemEditHref(item)}
          className="block px-3 py-2 text-sm hover:bg-neutral-50 font-medium"
        >
          Edit listing
        </Link>
        <Link
          href={`/seller-hub/store/new?similar=${listingIdOf(item)}`}
          className="block px-3 py-2 text-sm hover:bg-neutral-50"
        >
          Sell Similar
        </Link>
        {item.slug && item.status !== "draft" ? (
          <Link
            href={`/storefront/${item.slug}?from=my-items`}
            className="block px-3 py-2 text-sm hover:bg-neutral-50"
          >
            View listing
          </Link>
        ) : null}
        {tab === "sold" && item.soldOrderId ? (
          <Link
            href={`/seller-hub/orders/${item.soldOrderId}`}
            className="block px-3 py-2 text-sm hover:bg-neutral-50"
          >
            View order
          </Link>
        ) : null}
        {(tab === "ended" || (tab === "sold" && item.canRelist !== false)) && (
          <button
            type="button"
            className="block w-full text-left px-3 py-2 text-sm text-emerald-700 font-semibold hover:bg-neutral-50"
            onClick={() => relist([listingIdOf(item)])}
          >
            Relist
          </button>
        )}
        {tab === "active" && (
          <button
            type="button"
            className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-50"
            onClick={() => endListings([item.id])}
          >
            End listing
          </button>
        )}
      </div>
    ) : null;

  return (
    <div className="w-full min-w-0" data-testid="seller-hub-my-items">
      <ShareListingsToFeedPrompt
        open={feedShareIds.length > 0}
        storeItemIds={feedShareIds}
        onClose={() => setFeedShareIds([])}
        onSuccess={() => {
          setFeedShareIds([]);
          setSelectedIds([]);
          setActionMessage("Shared to Feed.");
        }}
      />
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-[var(--color-heading)]">My Items</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Your INW storefront listings — use Actions on each item, or select rows for quick actions.
        </p>
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

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link
          href="/seller-hub/store/new"
          className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-[var(--color-earth)] bg-[var(--color-earth)] px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
        >
          <IonIcon name="add-outline" size={18} className="text-current" />
          List an Item
        </Link>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "drafts"}
          className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-[#c99d5f] bg-[#c99d5f] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#b8894d] hover:border-[#b8894d]"
          onClick={() => setTabAndUrl("drafts")}
        >
          <IonIcon name="document-text-outline" size={18} className="text-current" />
          Drafts
          {counts != null ? ` (${counts.drafts})` : ""}
        </button>
      </div>

      <div className="mb-2">
        <h2 className="font-bold" style={{ color: "var(--color-heading)" }}>
          Your Listings
        </h2>
        <div className="text-sm text-neutral-600">
          {summaryCounts.active} active · {summaryCounts.ended} ended · {summaryCounts.sold} sold
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Listing status">
        {STATUS_TABS.map((t) => {
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
              className={`rounded-full border-2 px-5 py-2.5 text-sm font-semibold transition ${
                selected
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                  : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
              }`}
              onClick={() => setTabAndUrl(t.key)}
            >
              {t.label}
              {count != null ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 min-h-[2.75rem]">
        <label className="sr-only" htmlFor="my-items-search">
          Search items
        </label>
        <input
          id="my-items-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title or SKU"
          className="w-full max-w-md rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm"
        />
        {filtered.length > 0 ? (
          <label className="inline-flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-neutral-300"
            />
            Select all
            {selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
          </label>
        ) : null}
        {hasSelection ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {(tab === "ended" || tab === "sold") && (
              <button
                type="button"
                disabled={acting}
                className="rounded-md bg-[var(--color-earth)] px-3 py-1.5 font-semibold text-white hover:opacity-90 disabled:opacity-50"
                onClick={() => {
                  const listingIds =
                    tab === "sold"
                      ? Array.from(
                          new Set(
                            items
                              .filter((i) => selectedIds.includes(i.id) && i.canRelist !== false)
                              .map((i) => listingIdOf(i))
                          )
                        )
                      : selectedIds;
                  if (listingIds.length === 0) {
                    setActionMessage("Select a fully sold-out listing to relist.");
                    return;
                  }
                  relist(listingIds);
                }}
              >
                Relist
              </button>
            )}
            {tab === "active" && (
              <>
                <button
                  type="button"
                  disabled={acting}
                  className="rounded-md bg-[var(--color-earth)] px-3 py-1.5 font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  onClick={() => endListings(selectedIds)}
                >
                  End
                </button>
                <button
                  type="button"
                  disabled={acting}
                  className="rounded-md bg-[var(--color-earth)] px-3 py-1.5 font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  onClick={() => openShareToFeed(selectedIds)}
                >
                  Share to Feed
                </button>
              </>
            )}
            <button
              type="button"
              disabled={acting}
              className="rounded-md bg-[var(--color-earth)] px-3 py-1.5 font-semibold text-white hover:opacity-90 disabled:opacity-50"
              onClick={() =>
                setActionMessage("Manage 3rd Parties — coming soon. Tell us what this should do next.")
              }
            >
              Manage 3rd Parties
            </button>
            {selectedIds.length === 1 ? (
              <Link
                href={`/seller-hub/store/new?similar=${
                  (() => {
                    const one = items.find((i) => i.id === selectedIds[0]);
                    return one ? listingIdOf(one) : selectedIds[0];
                  })()
                }`}
                className="rounded-md bg-[var(--color-earth)] px-3 py-1.5 font-semibold text-white hover:opacity-90"
              >
                Sell Similar
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {loading ? <p className="text-sm text-neutral-600">Loading items…</p> : null}
      {fetchError ? <p className="text-sm text-red-700">{fetchError}</p> : null}

      {!loading && !fetchError && filtered.length === 0 ? (
        <div
          className="rounded-[10px] border-2 border-dashed p-6 text-center"
          style={{ borderColor: "var(--color-primary)" }}
        >
          <p
            className="font-semibold inline-flex items-center justify-center gap-2"
            style={{ color: "var(--color-heading)" }}
          >
            {tab === "drafts" ? (
              <>
                <IonIcon name="document-text-outline" size={22} className="text-[#c99d5f]" />
                No Drafts Yet
              </>
            ) : tab === "active" ? (
              "No active listings yet"
            ) : tab === "ended" ? (
              "No ended listings"
            ) : (
              "No sold listings yet"
            )}
          </p>
          {tab === "active" || tab === "drafts" ? (
            <>
              {tab === "drafts" ? (
                <p className="mt-2 text-sm text-neutral-600 max-w-md mx-auto">
                  Use Save as Draft when creating a listing, then continue editing anytime from here.
                </p>
              ) : null}
              <Link href="/seller-hub/store/new" className="btn mt-4 inline-block">
                {tab === "drafts" ? "Start a New Listing" : "Create your first listing"}
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      {!loading && !fetchError && filtered.length > 0 ? (
        <>
          {/* Mobile: stacked cards — avoids horizontal table scroll */}
          <ul className="md:hidden relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 divide-y divide-neutral-200 border-y border-neutral-200">
            {filtered.map((item) => {
              const photo = Array.isArray(item.photos) ? item.photos[0] : undefined;
              const selected = selectedIds.includes(item.id);
              const views = item.views30d ?? 0;
              const status = statusLabel(item);
              return (
                <li
                  key={item.id}
                  className={`px-4 py-3 ${selected ? "bg-[var(--color-section-alt)]" : "bg-white"}`}
                  data-item-menu={item.id}
                >
                  <div className="flex gap-3">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelect(item.id)}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-neutral-300"
                      aria-label={`Select ${item.title}`}
                    />
                    <div className="w-14 h-14 rounded-md bg-neutral-100 overflow-hidden shrink-0">
                      {photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photo} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-300">
                          <IonIcon name="image-outline" size={20} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={itemTitleHref(item)}
                        className="font-medium underline line-clamp-2 text-sm"
                        style={{ color: "var(--color-primary)" }}
                      >
                        {item.title}
                      </Link>
                      {tab === "sold" && item.variantLabel ? (
                        <div className="mt-0.5 text-xs font-medium text-neutral-700">
                          {item.variantLabel}
                        </div>
                      ) : null}
                      {tab === "sold" && item.soldAt ? (
                        <div className="mt-0.5 text-xs text-neutral-500">
                          Sold {new Date(item.soldAt).toLocaleDateString()}
                          {item.soldChannel === "etsy"
                            ? " · Etsy"
                            : item.soldChannel === "inw"
                              ? " · INW"
                              : ""}
                        </div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-700">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${statusChipClass(status)}`}
                        >
                          {status}
                        </span>
                        <span>
                          Qty {tab === "sold" ? item.soldQty ?? item.quantity : item.quantity}
                        </span>
                        <span>{formatPrice(item.priceCents)}</span>
                        <span>{views} views</span>
                      </div>
                      <div className="mt-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 mb-1">
                          Listed On
                        </div>
                        <AppsAirportListedOnChannels channels={item.channels} />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 relative">
                        {(tab === "ended" || (tab === "sold" && item.canRelist !== false)) && (
                          <button
                            type="button"
                            disabled={acting}
                            className="btn text-xs px-3 py-1.5 disabled:opacity-50"
                            onClick={() => relist([listingIdOf(item)])}
                          >
                            Relist
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn text-xs px-3 py-1.5"
                          aria-expanded={menuOpenId === item.id}
                          onClick={() => setMenuOpenId(menuOpenId === item.id ? null : item.id)}
                        >
                          Actions
                        </button>
                        {manageMenu(item, "left")}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Desktop: full-bleed table */}
          <div className="hidden md:block relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: "var(--color-primary)" }}>
                  <th className="py-2 pl-4 sm:pl-6 pr-3 w-10">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="py-2 pr-3 font-semibold">Listing</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold">Qty</th>
                  <th className="py-2 pr-3 font-semibold">Price</th>
                  <th className="py-2 pr-3 font-semibold">Listed On</th>
                  <th className="py-2 pr-3 font-semibold">Views (30d)</th>
                  <th className="py-2 pr-4 sm:pr-6 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const photo = Array.isArray(item.photos) ? item.photos[0] : undefined;
                  const selected = selectedIds.includes(item.id);
                  const views = item.views30d ?? 0;
                  const status = statusLabel(item);
                  return (
                    <tr
                      key={item.id}
                      className={`border-b border-neutral-200 align-middle ${
                        selected ? "bg-[var(--color-section-alt)]" : ""
                      }`}
                      data-item-menu={item.id}
                    >
                      <td className="py-3 pl-4 sm:pl-6 pr-3">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleSelect(item.id)}
                          className="h-4 w-4 rounded border-neutral-300"
                          aria-label={`Select ${item.title}`}
                        />
                      </td>
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-3 min-w-[14rem]">
                          <div className="w-12 h-12 rounded-md bg-neutral-100 overflow-hidden shrink-0">
                            {photo ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={photo} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-neutral-300">
                                <IonIcon name="image-outline" size={18} />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <Link
                              href={itemTitleHref(item)}
                              className="font-medium underline line-clamp-2"
                              style={{ color: "var(--color-primary)" }}
                            >
                              {item.title}
                            </Link>
                            {tab === "sold" && item.variantLabel ? (
                              <div className="mt-0.5 text-xs font-medium text-neutral-700">
                                {item.variantLabel}
                              </div>
                            ) : null}
                            {tab === "sold" && item.soldAt ? (
                              <div className="mt-0.5 text-xs text-neutral-500">
                                Sold {new Date(item.soldAt).toLocaleDateString()}
                                {item.soldChannel === "etsy"
                                  ? " · Etsy"
                                  : item.soldChannel === "inw"
                                    ? " · INW"
                                    : ""}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusChipClass(status)}`}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap">
                        {tab === "sold" ? item.soldQty ?? item.quantity : item.quantity}
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap">{formatPrice(item.priceCents)}</td>
                      <td className="py-3 pr-3 whitespace-nowrap">
                        <AppsAirportListedOnChannels channels={item.channels} />
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap text-neutral-700">{views}</td>
                      <td className="py-3 pr-4 sm:pr-6 relative">
                        <div className="flex flex-wrap items-center gap-2">
                          {(tab === "ended" || (tab === "sold" && item.canRelist !== false)) && (
                            <button
                              type="button"
                              disabled={acting}
                              className="btn text-xs px-3 py-1.5 disabled:opacity-50"
                              onClick={() => relist([listingIdOf(item)])}
                            >
                              Relist
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn text-xs px-3 py-1.5"
                            aria-expanded={menuOpenId === item.id}
                            onClick={() => setMenuOpenId(menuOpenId === item.id ? null : item.id)}
                          >
                            Actions
                          </button>
                        </div>
                        {manageMenu(item, "right")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
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
