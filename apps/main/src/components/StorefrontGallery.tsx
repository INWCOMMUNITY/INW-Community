"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { HeartSaveButton } from "@/components/HeartSaveButton";
import { ShareButton } from "@/components/ShareButton";
import { useCart } from "@/contexts/CartContext";

function AddToCartButton({
  itemId,
  slug,
  hasVariants,
  onAdded,
  basePath,
}: {
  itemId: string;
  slug: string;
  hasVariants: boolean;
  onAdded: () => void;
  basePath: string;
}) {
  const { data: session } = useSession();
  const { refresh } = useCart();
  const [loading, setLoading] = useState(false);

  async function handleAdd() {
    if (hasVariants) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemId: itemId, quantity: 1 }),
      });
      if (res.ok) {
        refresh();
        onAdded();
      }
    } finally {
      setLoading(false);
    }
  }

  const greenBtnClass = "inline-flex items-center justify-center gap-1.5 text-sm font-medium rounded px-3 py-2 h-[2.75rem] max-md:h-[2.475rem] max-md:w-[2.475rem] max-md:min-w-[2.475rem] max-md:!p-0 max-md:shrink-0 disabled:opacity-50";
  const greenStyle = { backgroundColor: "var(--color-primary)", color: "white" };
  const cartIcon = (
    <>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 max-md:w-3.5 max-md:h-3.5"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
      <span>+</span>
    </>
  );
  if (!session?.user) {
    return (
      <Link href={`/login?callbackUrl=${encodeURIComponent(basePath)}`} className={`${greenBtnClass} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`} aria-label="Add to Cart">
        {cartIcon}
        <span className="max-md:sr-only">Add to Cart</span>
      </Link>
    );
  }

  if (hasVariants) {
    return (
      <Link href={`${basePath}/${slug}`} className={greenBtnClass} style={greenStyle} aria-label="View options">
        {cartIcon}
        <span className="max-md:sr-only">View options</span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={loading}
      className={greenBtnClass}
      style={greenStyle}
      aria-label={loading ? "Adding…" : "Add to Cart"}
    >
      {cartIcon}
      <span className="max-md:sr-only">{loading ? "Adding…" : "Add to Cart"}</span>
    </button>
  );
}

interface StoreItem {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  photos: string[];
  category: string | null;
  priceCents: number;
  quantity: number;
  variants?: { name: string; options: string[] }[];
  member?: { firstName: string; lastName: string };
  business?: { name: string; slug: string };
}

function StorefrontCard({
  item,
  savedIds,
  onAdded,
  basePath,
  listingType,
}: {
  item: StoreItem;
  savedIds: Set<string>;
  onAdded: () => void;
  basePath: string;
  listingType: "resale" | "new";
}) {
  const [hoveredPhotoIndex, setHoveredPhotoIndex] = useState(0);
  const photoUrl = item.photos.length > 0 ? item.photos[hoveredPhotoIndex % item.photos.length] : null;

  return (
    <div className="border-2 border-[var(--color-primary)] rounded-lg overflow-hidden transition relative">
      <div className="absolute top-1 right-1 z-10 flex gap-1 max-md:scale-[0.8] max-md:origin-top-right">
        <HeartSaveButton
          type="store_item"
          referenceId={item.id}
          initialSaved={savedIds.has(item.id)}
          className="bg-white/90 rounded-full border border-[var(--color-primary)] p-1"
        />
        <ShareButton
          type="store_item"
          id={item.id}
          slug={item.slug}
          listingType={listingType}
          title={item.title}
          className="bg-white/90 rounded-full border border-[var(--color-primary)] p-1"
        />
      </div>
      <Link
        href={`${basePath}/${item.slug}`}
        onMouseEnter={() => {
          if (item.photos.length > 1) {
            setHoveredPhotoIndex((i) => (i + 1) % item.photos.length);
          }
        }}
        onMouseLeave={() => setHoveredPhotoIndex(0)}
        className="block aspect-square w-full relative"
      >
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={item.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center opacity-60 text-xs"
            style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-text)" }}
          >
            No image
          </div>
        )}
      </Link>
      <div className="p-2.5">
        <h2 className="text-sm font-bold leading-tight line-clamp-2">
          <Link href={`${basePath}/${item.slug}`} className="hover:underline">
            {item.title}
          </Link>
        </h2>
        {item.business && (
          <Link
            href={`/support-local/${item.business.slug}`}
            className="text-xs hover:underline block truncate"
            style={{ color: "var(--color-link)" }}
          >
            {item.business.name}
          </Link>
        )}
        {item.description && (
          <p className="text-xs text-gray-600 mt-1 line-clamp-2">{item.description}</p>
        )}
        <p className="text-sm font-bold mt-1">${(item.priceCents / 100).toFixed(2)}</p>
        <div className="flex flex-wrap gap-2 mt-2 justify-center items-stretch max-md:justify-center md:hidden">
          <AddToCartButton itemId={item.id} slug={item.slug} hasVariants={!!item.variants?.length} onAdded={onAdded} basePath={basePath} />
          <Link href={`${basePath}/${item.slug}`} className="inline-flex items-center justify-center h-[2.75rem] max-md:h-[2.475rem] px-3 py-2 max-md:px-2.5 max-md:py-1.5 border border-gray-300 bg-white hover:bg-gray-50 rounded text-sm max-md:text-xs font-medium">
            See details
          </Link>
        </div>
      </div>
    </div>
  );
}

function FilterAccordion({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-gray-200 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between py-3 text-left text-sm font-semibold text-gray-800 hover:text-gray-600"
        aria-expanded={open}
      >
        {label}
        <span className="text-gray-500 text-lg leading-none" aria-hidden>
          {open ? "−" : "+"}
        </span>
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

export type StorefrontGalleryProps = {
  listingType?: "new" | "resale";
  basePath?: string;
  storageKey?: string;
  placeholder?: string;
  search?: string;
  onSearchChange?: (value: string) => void;
};

export function StorefrontGallery({
  listingType = "new",
  basePath = "/storefront",
  storageKey = "storefrontFilters",
  placeholder = "Search storefront...",
  search: searchProp,
  onSearchChange,
}: StorefrontGalleryProps = {}) {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { setOpen: setCartOpen } = useCart();
  const [items, setItems] = useState<StoreItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [size, setSize] = useState("");
  const [searchInternal, setSearchInternal] = useState("");
  const search = searchProp ?? searchInternal;
  const setSearch = onSearchChange ?? setSearchInternal;
  const [deliveryFilter, setDeliveryFilter] = useState<"" | "local" | "shipping">("");
  const [productTypeOpen, setProductTypeOpen] = useState(true);
  const [priceOpen, setPriceOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(true);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const local = searchParams.get("localDelivery");
    const ship = searchParams.get("shippingOnly");
    if (local === "1") setDeliveryFilter("local");
    else if (ship === "1") setDeliveryFilter("shipping");
  }, [searchParams]);

  useEffect(() => {
    if (session?.user) {
      fetch("/api/saved?type=store_item")
        .then((r) => r.json())
        .then((list: { referenceId: string }[]) => {
          setSavedIds(new Set(list.map((i) => i.referenceId)));
        })
        .catch(() => {});
    }
  }, [session?.user]);

  useLockBodyScroll(browseOpen || filterOpen);

  useEffect(() => {
    const params = new URLSearchParams({ list: "meta", listingType });
    fetch(`/api/store-items?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.categories)) setCategories(d.categories);
        if (Array.isArray(d?.sizes)) setSizes(d.sizes);
      })
      .catch(() => {});
  }, [listingType]);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ category, size, search, deliveryFilter })
      );
    } catch {
      /* ignore */
    }
  }, [storageKey, category, size, search, deliveryFilter]);

  useEffect(() => {
    setFetchError(null);
    const params = new URLSearchParams({ listingType });
    if (category) params.set("category", category);
    if (size) params.set("size", size);
    if (search) params.set("search", search);
    if (deliveryFilter === "local") params.set("localDelivery", "1");
    if (deliveryFilter === "shipping") params.set("shippingOnly", "1");
    fetch(`/api/store-items?${params}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((d as { error?: string }).error ?? "Failed to load items.");
        return Array.isArray(d) ? d : [];
      })
      .then(setItems)
      .catch((err) => {
        setFetchError(err instanceof Error ? err.message : "Failed to load items.");
        setItems([]);
      });
  }, [listingType, category, size, search, deliveryFilter]);

  const browsePanel = (
    <div className="rounded-lg border-2 bg-white shadow-sm overflow-hidden p-4" style={{ borderColor: "var(--color-primary)" }}>
      <h2 className="text-sm font-bold text-gray-900 mb-3">Browse by</h2>
      <div className="h-px bg-gray-200 my-3" aria-hidden />
      <nav className="flex flex-col gap-0.5">
        <button type="button" onClick={() => { setCategory(""); setBrowseOpen(false); }} className={`text-left py-1.5 text-sm ${category === "" ? "text-[var(--color-primary)] font-medium underline" : "text-gray-700 hover:text-gray-900"}`}>All Products</button>
        {categories.map((c) => (
          <button key={c} type="button" onClick={() => { setCategory(c); setBrowseOpen(false); }} className={`text-left py-1.5 text-sm ${category === c ? "text-[var(--color-primary)] font-medium underline" : "text-gray-700 hover:text-gray-900"}`}>{c}</button>
        ))}
      </nav>
    </div>
  );

  const filterPanel = (
    <div className="rounded-lg border-2 bg-white shadow-sm overflow-hidden p-4" style={{ borderColor: "var(--color-primary)" }}>
      <h2 className="text-sm font-bold text-gray-900 mb-3">Filter by</h2>
      <div className="h-px bg-gray-200 my-3" aria-hidden />
      <FilterAccordion label="Price" open={priceOpen} onToggle={() => setPriceOpen((o) => !o)}>
        <p className="text-sm text-gray-500">Price filter coming soon.</p>
      </FilterAccordion>
      <FilterAccordion label="Size" open={sizeOpen} onToggle={() => setSizeOpen((o) => !o)}>
        <div className="space-y-2">
          {sizes.map((s) => (
            <label key={s} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <input type="checkbox" checked={size === s} onChange={() => setSize(size === s ? "" : s)} className="rounded border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]" />
              {s}
            </label>
          ))}
          {sizes.length === 0 && <p className="text-sm text-gray-500">No sizes yet.</p>}
        </div>
      </FilterAccordion>
      <FilterAccordion label="Delivery" open={deliveryOpen} onToggle={() => setDeliveryOpen((o) => !o)}>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
            <input type="radio" name="deliveryFilterPanel" checked={deliveryFilter === ""} onChange={() => setDeliveryFilter("")} className="border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]" />
            All
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
            <input type="radio" name="deliveryFilterPanel" checked={deliveryFilter === "local"} onChange={() => setDeliveryFilter("local")} className="border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]" />
            Local Delivery
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
            <input type="radio" name="deliveryFilterPanel" checked={deliveryFilter === "shipping"} onChange={() => setDeliveryFilter("shipping")} className="border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]" />
            Shipping only
          </label>
        </div>
      </FilterAccordion>
    </div>
  );

  const sidebarContent = (
    <div
      className="rounded-lg border-2 p-4 space-y-6 bg-white"
      style={{ borderColor: "var(--color-primary)" }}
    >
      <div>
        <h2 className="text-sm font-bold text-gray-900 mb-3">Browse by</h2>
        <div className="h-px bg-gray-200 my-3" aria-hidden />
        <nav className="flex flex-col gap-0.5">
          <button type="button" onClick={() => setCategory("")} className={`text-left py-1.5 text-sm ${category === "" ? "text-[var(--color-primary)] font-medium underline" : "text-gray-700 hover:text-gray-900"}`}>All Products</button>
          {categories.map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} className={`text-left py-1.5 text-sm ${category === c ? "text-[var(--color-primary)] font-medium underline" : "text-gray-700 hover:text-gray-900"}`}>{c}</button>
          ))}
        </nav>
      </div>
      <div>
        <h2 className="text-sm font-bold text-gray-900 mb-3">Filter by</h2>
        <div className="h-px bg-gray-200 my-3" aria-hidden />
        <FilterAccordion label="Price" open={priceOpen} onToggle={() => setPriceOpen((o) => !o)}>
          <p className="text-sm text-gray-500">Price filter coming soon.</p>
        </FilterAccordion>
        <FilterAccordion label="Size" open={sizeOpen} onToggle={() => setSizeOpen((o) => !o)}>
          <div className="space-y-2">
            {sizes.map((s) => (
              <label key={s} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input type="checkbox" checked={size === s} onChange={() => setSize(size === s ? "" : s)} className="rounded border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]" />
                {s}
              </label>
            ))}
            {sizes.length === 0 && <p className="text-sm text-gray-500">No sizes yet.</p>}
          </div>
        </FilterAccordion>
        <FilterAccordion label="Delivery" open={deliveryOpen} onToggle={() => setDeliveryOpen((o) => !o)}>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <input type="radio" name="deliveryFilterSidebar" checked={deliveryFilter === ""} onChange={() => setDeliveryFilter("")} className="border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]" />
              All
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <input type="radio" name="deliveryFilterSidebar" checked={deliveryFilter === "local"} onChange={() => setDeliveryFilter("local")} className="border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]" />
              Local Delivery
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <input type="radio" name="deliveryFilterSidebar" checked={deliveryFilter === "shipping"} onChange={() => setDeliveryFilter("shipping")} className="border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]" />
              Shipping only
            </label>
          </div>
        </FilterAccordion>
      </div>
    </div>
  );

  return (
    <>
      {/* Browse by side panel (not full screen) */}
      {browseOpen && (
        <div className="fixed inset-0 z-[90] overflow-hidden" aria-modal="true" role="dialog">
          <button type="button" onClick={() => setBrowseOpen(false)} className="absolute inset-0 bg-black/40" aria-label="Close" />
          <div className="absolute top-0 right-0 w-full max-w-[20rem] h-full bg-white shadow-xl overflow-y-auto p-4 border-l-2" style={{ borderColor: "var(--color-primary)" }}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">Browse by</h2>
              <button type="button" onClick={() => setBrowseOpen(false)} className="p-2 rounded-full hover:bg-gray-100" aria-label="Close">×</button>
            </div>
            {browsePanel}
          </div>
        </div>
      )}

      {/* Filter by side panel (not full screen) */}
      {filterOpen && (
        <div className="fixed inset-0 z-[90] overflow-hidden" aria-modal="true" role="dialog">
          <button type="button" onClick={() => setFilterOpen(false)} className="absolute inset-0 bg-black/40" aria-label="Close" />
          <div className="absolute top-0 right-0 w-full max-w-[20rem] h-full bg-white shadow-xl overflow-y-auto p-4 border-l-2" style={{ borderColor: "var(--color-primary)" }}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">Filter by</h2>
              <button type="button" onClick={() => setFilterOpen(false)} className="p-2 rounded-full hover:bg-gray-100" aria-label="Close">×</button>
            </div>
            {filterPanel}
          </div>
        </div>
      )}

      <div className="mt-8 w-full max-w-[var(--max-width)] mx-auto pb-8 flex flex-col md:flex-row gap-6 md:gap-8 md:pl-0 md:pr-4 px-4 md:px-0">
        {/* Desktop: left sidebar centered between left wall and items */}
        <aside
          className="hidden md:flex md:justify-center shrink-0 w-[16rem] self-start sticky top-4 pl-0"
          style={{ marginLeft: "calc(min(0px, -1.5rem - (100vw - 3rem - var(--max-width)) / 2) + 1rem)" }}
        >
          <div className="w-56 shrink-0">
            {sidebarContent}
          </div>
        </aside>
        <div
          className="flex-1 min-w-0 md:ml-28"
        >
        <div className="flex gap-3 justify-center mb-6 max-md:flex md:hidden">
          <button type="button" onClick={() => { setBrowseOpen(true); setFilterOpen(false); }} className="flex-1 max-w-[12rem] btn border border-gray-300 bg-white hover:bg-gray-50 py-2.5">Browse by</button>
          <button type="button" onClick={() => { setFilterOpen(true); setBrowseOpen(false); }} className="flex-1 max-w-[12rem] btn border border-gray-300 bg-white hover:bg-gray-50 py-2.5">Filter by</button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-8">
          {items.map((item) => (
            <StorefrontCard key={item.id} item={item} savedIds={savedIds} onAdded={() => setCartOpen(true)} basePath={basePath} listingType={listingType} />
          ))}
        </div>
        {fetchError && (
          <div className="mt-6 rounded-lg border-2 border-red-300 p-6 bg-red-50">
            <p className="text-red-700">{fetchError}</p>
          </div>
        )}
        {items.length === 0 && !fetchError && (
          <p className="text-gray-600 mt-6">No items match your search or filters.</p>
        )}
        </div>
      </div>
    </>
  );
}
