"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { listingDescriptionPreview } from "@/lib/channels/rich-description";
import { HeartSaveButton } from "@/components/HeartSaveButton";
import { ShareButton } from "@/components/ShareButton";
import { IonIcon } from "@/components/IonIcon";
import { useCart } from "@/contexts/CartContext";
import { CARD_SHADOW, CARD_RADIUS } from "@/components/ui/card-styles";
type BrowseCategoryOption = { label: string; subcategories: string[] };

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
  subcategory: string | null;
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
}: {
  item: StoreItem;
  savedIds: Set<string>;
  onAdded: () => void;
  basePath: string;
}) {
  const [hoveredPhotoIndex, setHoveredPhotoIndex] = useState(0);
  const photoUrl = item.photos.length > 0 ? item.photos[hoveredPhotoIndex % item.photos.length] : null;

  return (
    <div className={`group border-2 border-[var(--color-primary)] ${CARD_RADIUS} ${CARD_SHADOW} overflow-hidden relative bg-white transition-all duration-300 hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(80,85,66,0.15)]`}>
      <Link
        href={`${basePath}/${item.slug}`}
        onMouseEnter={() => {
          if (item.photos.length > 1) {
            setHoveredPhotoIndex((i) => (i + 1) % item.photos.length);
          }
        }}
        onMouseLeave={() => setHoveredPhotoIndex(0)}
        className="block aspect-square w-full relative bg-[#F8F8F3] p-2 border-b-2 border-[var(--color-primary)] overflow-hidden"
      >
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={item.title}
            className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center opacity-60 text-xs"
            style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-text)" }}
          >
            No image
          </div>
        )}
        {/* Price ribbon tag */}
        <div className="absolute bottom-2 left-0 bg-[var(--color-primary)] text-white text-sm font-bold px-3 py-1 rounded-r-md shadow-md">
          ${(item.priceCents / 100).toFixed(2)}
        </div>
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
          <p className="text-xs text-gray-600 mt-1 line-clamp-2">
            {listingDescriptionPreview(item.description)}
          </p>
        )}
        {/* Action buttons row */}
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
          <div className="flex gap-1.5">
            <HeartSaveButton
              type="store_item"
              referenceId={item.id}
              initialSaved={savedIds.has(item.id)}
              className="card-action-btn"
              iconSize={16}
              iconClassName="card-action-icon"
            />
            <ShareButton
              type="store_item"
              id={item.id}
              slug={item.slug}
              title={item.title}
              className="card-action-btn"
              iconSize={16}
              iconClassName="card-action-icon"
            />
          </div>
          <Link 
            href={`${basePath}/${item.slug}`} 
            className="text-xs font-medium text-[var(--color-primary)] hover:underline"
          >
            View details →
          </Link>
        </div>
      </div>
    </div>
  );
}


export type StorefrontGalleryProps = {
  basePath?: string;
  storageKey?: string;
  placeholder?: string;
  search?: string;
  onSearchChange?: (value: string) => void;
};

export function StorefrontGallery({
  basePath = "/storefront",
  storageKey = "storefrontFilters",
  placeholder = "Search storefront...",
  search: searchProp,
  onSearchChange,
}: StorefrontGalleryProps = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const { setOpen: setCartOpen } = useCart();
  const [items, setItems] = useState<StoreItem[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [browseByCategories, setBrowseByCategories] = useState<BrowseCategoryOption[]>([]);
  
  // Initialize from URL params
  const urlCategory = searchParams?.get("category") ?? "";
  const urlSubcategory = searchParams?.get("subcategory") ?? "";
  const urlSize = searchParams?.get("size") ?? "";
  const urlSearch = searchParams?.get("search") ?? "";
  const urlCondition = searchParams?.get("condition") as "" | "new" | "used" || "";
  const urlDelivery = searchParams?.get("localDelivery") === "1" ? "local" 
    : searchParams?.get("shippingOnly") === "1" ? "shipping" : "";
  const urlMinPrice = searchParams?.get("minPrice") ?? "";
  const urlMaxPrice = searchParams?.get("maxPrice") ?? "";
  
  const [category, setCategory] = useState(urlCategory);
  const [subcategory, setSubcategory] = useState(urlSubcategory);
  const [size, setSize] = useState(urlSize);
  const [searchInternal, setSearchInternal] = useState(searchProp ?? urlSearch);
  const search = searchProp ?? searchInternal;
  const setSearch = onSearchChange ?? setSearchInternal;
  const [deliveryFilter, setDeliveryFilter] = useState<"" | "local" | "shipping">(urlDelivery);
  const [conditionFilter, setConditionFilter] = useState<"" | "new" | "used">(urlCondition);
  const [minPrice, setMinPrice] = useState(urlMinPrice);
  const [maxPrice, setMaxPrice] = useState(urlMaxPrice);
  const [filterOpen, setFilterOpen] = useState(false);
  const [browseExpanded, setBrowseExpanded] = useState(true);
  const lastScrollYRef = useRef(0);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

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


  const fetchMeta = useCallback(() => {
    const params = new URLSearchParams({ list: "meta" });
    fetch(`/api/store-items?${params}`)
      .then((r) => r.json())
      .then((d: { sizes?: string[]; browseByCategories?: BrowseCategoryOption[]; categories?: string[] }) => {
        if (Array.isArray(d?.sizes)) setSizes(d.sizes);
        if (Array.isArray(d?.browseByCategories) && d.browseByCategories.length > 0) {
          setBrowseByCategories(d.browseByCategories);
        } else if (Array.isArray(d?.categories)) {
          setBrowseByCategories(d.categories.map((label) => ({ label, subcategories: [] })));
        } else {
          setBrowseByCategories([]);
        }
      })
      .catch(() => {});
  }, []);

  const fetchItems = useCallback(() => {
    setFetchError(null);
    const params = new URLSearchParams();
    if (conditionFilter) params.set("condition", conditionFilter);
    if (category) params.set("category", category);
    if (subcategory) params.set("subcategory", subcategory);
    if (size) params.set("size", size);
    if (search) params.set("search", search);
    if (deliveryFilter === "local") params.set("localDelivery", "1");
    if (deliveryFilter === "shipping") params.set("shippingOnly", "1");
    if (minPrice) params.set("minPrice", minPrice);
    if (maxPrice) params.set("maxPrice", maxPrice);
    params.set("_", String(Date.now()));
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
  }, [conditionFilter, category, subcategory, size, search, deliveryFilter, minPrice, maxPrice]);

  useEffect(() => {
    fetchMeta();
  }, [fetchMeta]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const visibilitySkipRef = useRef(true);
  useEffect(() => {
    const onVisible = () => {
      if (typeof document === "undefined" || document.visibilityState !== "visible") return;
      if (visibilitySkipRef.current) {
        visibilitySkipRef.current = false;
        return;
      }
      fetchMeta();
      fetchItems();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [fetchMeta, fetchItems]);

  // Collapse browse/filter box when scrolling down
  useEffect(() => {
    lastScrollYRef.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastScrollYRef.current;
      if (delta > 4 && y > 64) {
        setBrowseExpanded(false);
        setFilterOpen(false);
      }
      lastScrollYRef.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (browseByCategories.length === 0) {
      if (category) {
        setCategory("");
        setSubcategory("");
      }
      return;
    }
    const labels = new Set(browseByCategories.map((c) => c.label));
    if (category && !labels.has(category)) {
      setCategory("");
      setSubcategory("");
      return;
    }
    if (category && subcategory) {
      const subs = browseByCategories.find((c) => c.label === category)?.subcategories ?? [];
      if (!subs.includes(subcategory)) setSubcategory("");
    }
  }, [browseByCategories, category, subcategory]);

  // Sync filter state to URL params (for shareable URLs) and sessionStorage (for return navigation)
  useEffect(() => {
    // Update URL params (shallow update, no navigation)
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (subcategory) params.set("subcategory", subcategory);
    if (size) params.set("size", size);
    if (search && !searchProp) params.set("search", search);
    if (conditionFilter) params.set("condition", conditionFilter);
    if (deliveryFilter === "local") params.set("localDelivery", "1");
    if (deliveryFilter === "shipping") params.set("shippingOnly", "1");
    if (minPrice) params.set("minPrice", minPrice);
    if (maxPrice) params.set("maxPrice", maxPrice);
    
    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    const currentUrl = typeof window !== "undefined" ? window.location.pathname + window.location.search : pathname;
    
    // Only update if the URL actually changed to avoid infinite loops
    if (newUrl !== currentUrl) {
      router.replace(newUrl, { scroll: false });
    }

    // Keep sessionStorage in sync for backward compatibility with product detail page
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ category, subcategory, size, search, deliveryFilter, conditionFilter, minPrice, maxPrice })
      );
    } catch {
      /* ignore */
    }
  }, [storageKey, pathname, router, category, subcategory, size, search, searchProp, deliveryFilter, conditionFilter, minPrice, maxPrice]);


  // Count active filters for badge
  const activeFilterCount = [
    conditionFilter,
    deliveryFilter,
    minPrice,
    maxPrice,
    size,
  ].filter(Boolean).length;

  return (
    <div className="w-full max-w-[var(--max-width)] mx-auto px-4">
      {/* Category & filters — contained box (sticky) */}
      <div className="sticky top-0 z-20 -mx-4 px-4 py-3 mb-6 bg-[#faf8f5]/90 backdrop-blur-md">
        <div
          className={`${CARD_RADIUS} ${CARD_SHADOW} border-2 border-[var(--color-primary)] bg-white overflow-hidden`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-gradient-to-r from-[#f6f1eb] to-white border-b border-[var(--color-primary)]/15">
            <p className="text-sm font-semibold text-[var(--color-heading)] tracking-wide">
              Browse the Storefront
            </p>
            <div className="flex items-center gap-2 ml-auto">
              {activeFilterCount > 0 && (
                <span className="text-xs font-medium text-[var(--color-primary)]">
                  {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active
                </span>
              )}
              {!browseExpanded && category && (
                <span className="text-xs text-gray-600 truncate max-w-[10rem]">{category}</span>
              )}
              <button
                type="button"
                onClick={() => {
                  setBrowseExpanded((open) => {
                    const next = !open;
                    if (!next) setFilterOpen(false);
                    return next;
                  });
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-primary)]/30 bg-white text-[var(--color-primary)] hover:bg-[var(--color-section-alt)] transition"
                aria-expanded={browseExpanded}
                aria-label={browseExpanded ? "Collapse filters" : "Expand filters"}
              >
                <IonIcon
                  name={browseExpanded ? "chevron-up-outline" : "chevron-down-outline"}
                  size={18}
                />
              </button>
            </div>
          </div>

          {browseExpanded && (
          <div className="p-4">
            {/* Category chips row */}
            <div
              className="flex flex-wrap sm:flex-nowrap gap-2 overflow-x-auto scrollbar-hide"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              <button
                type="button"
                onClick={() => { setCategory(""); setSubcategory(""); }}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition active:animate-chip-bounce shadow-sm ${
                  category === ""
                    ? "bg-[var(--color-primary)] text-white"
                    : "border border-[var(--color-primary)]/30 bg-[#faf8f5] text-[var(--color-primary)] hover:bg-[var(--color-section-alt)]"
                }`}
              >
                All
              </button>
              {browseByCategories.map((cat) => (
                <button
                  key={cat.label}
                  type="button"
                  onClick={() => { setCategory(cat.label); setSubcategory(""); }}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition active:animate-chip-bounce shadow-sm ${
                    category === cat.label
                      ? "bg-[var(--color-primary)] text-white"
                      : "border border-[var(--color-primary)]/30 bg-[#faf8f5] text-[var(--color-primary)] hover:bg-[var(--color-section-alt)]"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setFilterOpen(!filterOpen)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition active:animate-chip-bounce flex items-center gap-1.5 shadow-sm ml-auto sm:ml-0 ${
                  activeFilterCount > 0 || filterOpen
                    ? "bg-[var(--color-primary)] text-white"
                    : "border border-[var(--color-primary)]/30 bg-[#faf8f5] text-[var(--color-primary)] hover:bg-[var(--color-section-alt)]"
                }`}
                aria-expanded={filterOpen}
              >
                Filters
                {activeFilterCount > 0 && (
                  <span className="bg-white text-[var(--color-primary)] text-xs font-bold rounded-full min-w-[1.25rem] h-5 px-1 flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
                <IonIcon
                  name={filterOpen ? "chevron-up-outline" : "chevron-down-outline"}
                  size={14}
                  className="opacity-90"
                  aria-hidden
                />
              </button>
            </div>

        {/* Subcategory chips (if category selected) */}
        {category && (browseByCategories.find((c) => c.label === category)?.subcategories.length ?? 0) > 0 && (
          <div
            className="mt-3 pt-3 border-t border-[var(--color-primary)]/10 flex gap-2 overflow-x-auto scrollbar-hide"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            <button
              type="button"
              onClick={() => setSubcategory("")}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition active:animate-chip-bounce ${
                subcategory === ""
                  ? "bg-[var(--color-secondary)] text-white"
                  : "border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"
              }`}
            >
              All {category}
            </button>
            {(browseByCategories.find((c) => c.label === category)?.subcategories ?? []).map((sub) => (
              <button
                key={sub}
                type="button"
                onClick={() => setSubcategory(sub)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition active:animate-chip-bounce ${
                  subcategory === sub
                    ? "bg-[var(--color-secondary)] text-white"
                    : "border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"
                }`}
              >
                {sub}
              </button>
            ))}
          </div>
        )}

        {/* Expandable filter panel */}
        {filterOpen && (
          <div className="mt-4 pt-4 border-t border-[var(--color-primary)]/15 bg-[#faf8f5]/80 rounded-lg px-3 pb-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-2">
              {/* Condition */}
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-2">Condition</h3>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: "", label: "All" },
                    { value: "new", label: "New" },
                    { value: "used", label: "Used" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setConditionFilter(opt.value as "" | "new" | "used")}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        conditionFilter === opt.value
                          ? "bg-[var(--color-primary)] text-white"
                          : "border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Delivery */}
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-2">Delivery</h3>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: "", label: "All" },
                    { value: "local", label: "Local Delivery" },
                    { value: "shipping", label: "Shipping" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDeliveryFilter(opt.value as "" | "local" | "shipping")}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        deliveryFilter === opt.value
                          ? "bg-[var(--color-primary)] text-white"
                          : "border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price */}
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-2">Price</h3>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Min"
                      value={minPrice}
                      onChange={(e) => setMinPrice(e.target.value)}
                      className="w-full pl-5 pr-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                    />
                  </div>
                  <span className="text-gray-400">–</span>
                  <div className="relative flex-1">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Max"
                      value={maxPrice}
                      onChange={(e) => setMaxPrice(e.target.value)}
                      className="w-full pl-5 pr-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                    />
                  </div>
                </div>
              </div>

              {/* Size */}
              {sizes.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">Size</h3>
                  <div className="flex flex-wrap gap-2">
                    {sizes.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSize(size === s ? "" : s)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                          size === s
                            ? "bg-[var(--color-primary)] text-white"
                            : "border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Clear filters */}
            {activeFilterCount > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => {
                    setConditionFilter("");
                    setDeliveryFilter("");
                    setMinPrice("");
                    setMaxPrice("");
                    setSize("");
                  }}
                  className="text-sm text-[var(--color-primary)] hover:underline font-medium"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        )}
          </div>
          )}
        </div>
      </div>

      {/* Product grid - full width with staggered animation */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
        {items.map((item, index) => (
          <div
            key={item.id}
            className="animate-fadeInUp"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <StorefrontCard item={item} savedIds={savedIds} onAdded={() => setCartOpen(true)} basePath={basePath} />
          </div>
        ))}
      </div>

      {fetchError && (
        <div className="mt-6 rounded-lg border-2 border-red-300 p-6 bg-red-50">
          <p className="text-red-700">{fetchError}</p>
        </div>
      )}
      {items.length === 0 && !fetchError && (
        <p className="text-gray-600 mt-6 text-center">No items match your search or filters.</p>
      )}
    </div>
  );
}
