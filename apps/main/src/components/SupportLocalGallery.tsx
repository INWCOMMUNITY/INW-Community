"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { HeartSaveButton } from "@/components/HeartSaveButton";
import { ThemeSelect } from "@/components/ThemeSelect";
import { IonIcon } from "@/components/IonIcon";
import { useSupportLocalDirectory } from "@/hooks/use-support-local-directory";

export function SupportLocalGallery() {
  const {
    businesses,
    search,
    setSearch,
    category,
    setCategory,
    subcategory,
    setSubcategory,
    city,
    setCity,
    cities,
    filteredCategories,
    filteredSubcategories,
    loading,
    connectionError,
    load,
    emptyMessage,
  } = useSupportLocalDirectory();

  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/saved?type=business", { credentials: "include" })
      .then((r) => r.json())
      .then((items) => {
        if (Array.isArray(items)) {
          setSavedIds(new Set(items.map((i: { referenceId: string }) => i.referenceId)));
        }
      })
      .catch(() => {});
  }, []);

  const filterInputClass =
    "w-full border-2 border-black rounded-lg px-3 py-2.5 text-base text-black bg-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-white/80";

  const chipScroll =
    "flex flex-nowrap gap-2 overflow-x-auto pb-2 mb-2 -mx-4 px-4 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.45)_transparent]";

  const filterChipBase =
    "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-primary)]";

  const filterBar = (
    <>
      <label className="sr-only" htmlFor="sl-search">
        Search businesses
      </label>
      <input
        id="sl-search"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search & Filter"
        className={filterInputClass + " mb-3"}
        aria-label="Search businesses"
        autoCorrect="on"
      />
      <div className={chipScroll} role="group" aria-label="City filter">
        <button
          type="button"
          aria-pressed={!city}
          onClick={() => setCity("")}
          className={
            filterChipBase +
            (!city ? " bg-white text-[var(--color-primary)]" : " bg-white/30 text-white")
          }
        >
          All cities
        </button>
        {cities.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={city === c}
            onClick={() => setCity(city === c ? "" : c)}
            className={
              filterChipBase +
              (city === c ? " bg-white text-[var(--color-primary)]" : " bg-white/30 text-white")
            }
          >
            {c}
          </button>
        ))}
      </div>
      <div className={chipScroll} role="group" aria-label="Category filter">
        <button
          type="button"
          aria-pressed={!category}
          onClick={() => setCategory("")}
          className={
            filterChipBase +
            (!category ? " bg-white text-[var(--color-primary)]" : " bg-white/30 text-white")
          }
        >
          All categories
        </button>
        {filteredCategories.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={category === c}
            onClick={() => setCategory(category === c ? "" : c)}
            className={
              filterChipBase +
              (category === c ? " bg-white text-[var(--color-primary)]" : " bg-white/30 text-white")
            }
          >
            {c}
          </button>
        ))}
      </div>
      {category ? (
        <div className={chipScroll} role="group" aria-label="Subcategory filter">
          <button
            type="button"
            aria-pressed={!subcategory}
            onClick={() => setSubcategory("")}
            className={
              filterChipBase +
              (!subcategory ? " bg-white text-[var(--color-primary)]" : " bg-white/30 text-white")
            }
          >
            All subs
          </button>
          {filteredSubcategories.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={subcategory === s}
              onClick={() => setSubcategory(subcategory === s ? "" : s)}
              className={
                filterChipBase +
                (subcategory === s ? " bg-white text-[var(--color-primary)]" : " bg-white/30 text-white")
              }
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );

  const businessGrid = loading ? (
    <p className="text-center text-gray-500 py-12 text-sm">Loading…</p>
  ) : connectionError ? (
    <div className="py-12 px-4 text-center">
      <p className="text-gray-700 text-sm mb-4">{connectionError}</p>
      <button
        type="button"
        onClick={() => void load()}
        className="rounded-lg border-2 border-black px-5 py-2.5 text-sm font-semibold text-white"
        style={{ backgroundColor: "var(--color-primary)" }}
      >
        Retry
      </button>
    </div>
  ) : businesses.length === 0 ? (
    <p className="text-center text-gray-600 text-sm mt-6 px-4">{emptyMessage}</p>
  ) : (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4 lg:gap-6 lg:justify-items-center">
      {businesses.map((b) => (
        <BusinessCard
          key={b.id}
          business={b}
          saved={savedIds.has(b.id)}
          expandedId={expandedId}
          onToggleExpand={() => setExpandedId((id) => (id === b.id ? null : b.id))}
          compact={false}
        />
      ))}
    </div>
  );

  const businessGridMobile = loading ? (
    <p className="text-center text-gray-500 py-12 text-sm">Loading…</p>
  ) : connectionError ? (
    <div className="py-12 px-4 text-center">
      <p className="text-gray-700 text-sm mb-4">{connectionError}</p>
      <button
        type="button"
        onClick={() => void load()}
        className="rounded-lg border-2 border-black px-5 py-2.5 text-sm font-semibold text-white"
        style={{ backgroundColor: "var(--color-primary)" }}
      >
        Retry
      </button>
    </div>
  ) : businesses.length === 0 ? (
    <p className="text-center text-gray-600 text-sm mt-6 px-4">{emptyMessage}</p>
  ) : (
    <div className="grid grid-cols-2 gap-3">
      {businesses.map((b) => (
        <BusinessCard key={b.id} business={b} saved={savedIds.has(b.id)} compact />
      ))}
    </div>
  );

  return (
    <>
      {/* Mobile: matches app Support Local tab */}
      <div className="lg:hidden w-full min-w-0">
        <div
          className="w-full border-b-2 border-black px-4 pt-4 pb-5 text-white"
          style={{ backgroundColor: "var(--color-primary)" }}
        >
          <div className="flex items-center justify-center gap-2 sm:gap-3 mb-4">
            <div className="flex flex-1 min-w-0 justify-end">
              <Link
                href="/coupons"
                prefetch={false}
                className="flex max-w-full flex-col items-center gap-1 rounded-full border-2 border-black bg-white px-2 py-2 text-center"
              >
                <IonIcon name="pricetag-outline" size={22} className="text-black" />
                <span
                  className="text-xs font-semibold leading-tight text-black sm:text-sm"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  Coupons
                </span>
              </Link>
            </div>
            <div className="relative h-[92px] w-[92px] shrink-0 overflow-hidden rounded-full border-[1.5px] border-black bg-white">
              <Image
                src="/nwc-logo-circle.png"
                alt="Northwest Community"
                width={92}
                height={92}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex flex-1 min-w-0 justify-start">
              <Link
                href="/rewards"
                prefetch={false}
                className="flex max-w-full flex-col items-center gap-1 rounded-full border-2 border-black bg-white px-2 py-2 text-center"
              >
                <IonIcon name="gift-outline" size={22} className="text-black" />
                <span
                  className="text-xs font-semibold leading-tight text-black sm:text-sm"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  Rewards
                </span>
              </Link>
            </div>
          </div>
          <p className="mb-1 text-center text-sm text-white/90">Spokane &amp; Kootenai County</p>
          <div className="mb-3 flex flex-wrap items-center justify-center gap-1 px-1">
            <h2
              className="text-center text-xl font-bold !text-white"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Local Business Directory
            </h2>
            <Link
              href="/support-local/sellers"
              prefetch={false}
              className="shrink-0 rounded p-1 text-white hover:bg-white/10"
              aria-label="View Local Sellers"
            >
              <IonIcon name="chevron-down-outline" size={20} className="text-white" />
            </Link>
          </div>
          <div className="mb-4 flex justify-center">
            <Link
              href="/support-nwc"
              prefetch={false}
              className="rounded-full border-2 border-black bg-white px-4 py-2 text-sm font-semibold text-black"
            >
              Join Directory
            </Link>
          </div>
          {filterBar}
        </div>

        <div
          className="w-full bg-white px-4 pt-4 pb-10"
          style={{ paddingBottom: "max(2.5rem, env(safe-area-inset-bottom))" }}
        >
          {businessGridMobile}
        </div>
      </div>

      {/* Desktop / tablet */}
      <div className="hidden lg:block">
        <div className="mb-8 rounded-lg border-2 border-[var(--color-secondary)] p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium mb-1">Search businesses</label>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search & Filter"
                className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-secondary)] focus:border-[var(--color-secondary)] hover:border-[var(--color-secondary)]"
                aria-label="Search businesses"
                autoCorrect="on"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">City</label>
              <ThemeSelect
                value={city}
                onChange={setCity}
                options={cities}
                placeholder="All"
                aria-label="City filter"
                className="min-w-[160px]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <ThemeSelect
                value={category}
                onChange={setCategory}
                options={filteredCategories}
                placeholder="All"
                aria-label="Category filter"
                className="min-w-[160px]"
              />
            </div>
            {category ? (
              <div>
                <label className="block text-sm font-medium mb-1">Subcategory</label>
                <ThemeSelect
                  value={subcategory}
                  onChange={setSubcategory}
                  options={filteredSubcategories}
                  placeholder="All"
                  aria-label="Subcategory filter"
                  className="min-w-[160px]"
                />
              </div>
            ) : null}
          </div>
        </div>
        {businessGrid}
      </div>
    </>
  );
}

function BusinessCard({
  business: b,
  saved,
  compact,
  expandedId,
  onToggleExpand,
}: {
  business: import("@/hooks/use-support-local-directory").DirectoryBusiness;
  saved: boolean;
  compact: boolean;
  expandedId?: string | null;
  onToggleExpand?: () => void;
}) {
  const location = [b.address, b.city].filter(Boolean).join(", ");

  if (compact) {
    return (
      <div className="relative flex flex-col border-2 border-black rounded-lg overflow-hidden bg-white">
        <div className="absolute top-2 right-2 z-10">
          <HeartSaveButton type="business" referenceId={b.id} initialSaved={saved} />
        </div>
        <div className="aspect-square w-full bg-[#f5f5f5] relative shrink-0">
          {b.logoUrl ? (
            <Image
              src={b.logoUrl}
              alt={b.name}
              fill
              sizes="50vw"
              className="object-cover"
              quality={90}
              unoptimized={b.logoUrl.startsWith("blob:")}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-section-alt)]">
              <IonIcon name="business" size={40} className="text-[var(--color-primary)]" />
            </div>
          )}
        </div>
        <div className="p-2.5 flex flex-col flex-1 min-w-0">
          <h3
            className="text-sm font-semibold leading-tight line-clamp-2"
            style={{ color: "var(--color-heading)" }}
          >
            {b.name}
          </h3>
          {b.shortDescription && (
            <p className="text-xs text-gray-700 mt-1 line-clamp-2 leading-snug">{b.shortDescription}</p>
          )}
          {location ? <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{location}</p> : null}
          {b.directorySearchMatchNote === "similar" ? (
            <p className="text-[10px] text-gray-500 mt-1 italic">Similar based on search</p>
          ) : null}
        </div>
        <Link
          href={`/support-local/${b.slug}`}
          prefetch={false}
          className="mx-3 mb-3 block rounded-lg py-2.5 text-center text-sm font-semibold text-white"
          style={{ backgroundColor: "var(--color-primary)" }}
        >
          See Business
        </Link>
      </div>
    );
  }

  return (
    <div className="border-2 border-[var(--color-primary)] rounded-lg overflow-hidden transition relative flex flex-col w-full max-w-[320px]">
      <div className="absolute top-2 right-2 z-10">
        <HeartSaveButton type="business" referenceId={b.id} initialSaved={saved} />
      </div>
      <div className="aspect-square w-full bg-gray-100 flex items-center justify-center shrink-0 relative">
        {b.logoUrl ? (
          <Image
            src={b.logoUrl}
            alt={b.name}
            fill
            sizes="(min-width: 1024px) 640px, 50vw"
            className="object-cover"
            quality={95}
            unoptimized={b.logoUrl.startsWith("blob:")}
          />
        ) : (
          <span className="text-gray-400 text-sm">No logo</span>
        )}
      </div>
      <div className="p-4 flex flex-col flex-1 min-w-0">
        <h2 className="text-lg font-bold leading-tight" style={{ color: "var(--color-heading)" }}>
          {b.name}
        </h2>
        {b.shortDescription && (
          <div className="flex-1 min-w-0 relative">
            <div className="flex items-start gap-1">
              <p className="text-gray-600 text-sm line-clamp-2 flex-1 min-w-0" title={b.shortDescription}>
                {b.shortDescription}
              </p>
              {onToggleExpand ? (
                <button
                  type="button"
                  onClick={onToggleExpand}
                  className="shrink-0 p-0.5 rounded transition-colors text-white hover:opacity-90"
                  style={{ backgroundColor: "var(--color-primary)" }}
                  aria-expanded={expandedId === b.id}
                  aria-label={expandedId === b.id ? "Collapse description" : "Show full description"}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className={`w-4 h-4 transition-transform text-white ${expandedId === b.id ? "rotate-180" : ""}`}
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              ) : null}
            </div>
            {expandedId === b.id && (
              <div
                className="mt-1 p-2 rounded border border-gray-200 bg-gray-50 text-gray-600 text-xs shadow-sm"
                role="region"
                aria-label="Full business description"
              >
                {b.shortDescription}
              </div>
            )}
          </div>
        )}
        {location ? <p className="text-gray-600 text-xs mt-1">{location}</p> : null}
        {b.directorySearchMatchNote === "similar" ? (
          <p className="text-xs text-gray-500 mt-1 italic">Similar based on search</p>
        ) : null}
        <Link
          href={`/support-local/${b.slug}`}
          className="btn mt-4 w-full flex items-center justify-center text-sm py-2 px-3 min-w-0 whitespace-nowrap"
        >
          See Business!
        </Link>
      </div>
    </div>
  );
}
