"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { HeartSaveButton } from "@/components/HeartSaveButton";
import { ThemeSelect } from "@/components/ThemeSelect";

interface Business {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  address: string | null;
  city: string | null;
  categories: string[];
  logoUrl: string | null;
  hoursOfOperation?: Record<string, string> | null;
}

export function SupportLocalGallery() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/businesses?list=meta")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.categories)) setCategories(d.categories);
        if (Array.isArray(d.cities)) setCities(d.cities);
      });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (category) params.set("category", category);
    if (city) params.set("city", city);
    fetch(`/api/businesses?${params}`)
      .then((r) => r.json())
      .then((d) => setBusinesses(Array.isArray(d) ? d : []));
  }, [search, category, city]);

  useEffect(() => {
    fetch("/api/saved?type=business")
      .then((r) => r.json())
      .then((items) => {
        if (Array.isArray(items)) {
          setSavedIds(new Set(items.map((i: { referenceId: string }) => i.referenceId)));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <div className="mb-8 rounded-lg border-2 border-[var(--color-secondary)] p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1">Search businesses</label>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, city, category, address..."
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-secondary)] focus:border-[var(--color-secondary)] hover:border-[var(--color-secondary)]"
              aria-label="Search businesses"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <ThemeSelect
              value={category}
              onChange={setCategory}
              options={categories}
              placeholder="All"
              aria-label="Category filter"
              className="min-w-[160px]"
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
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 justify-items-center">
        {businesses.map((b) => (
          <div
            key={b.id}
            className="border-2 border-[var(--color-primary)] rounded-lg overflow-hidden transition relative flex flex-col w-full max-w-[320px]"
          >
            <div className="absolute top-2 right-2 z-10">
              <HeartSaveButton
                type="business"
                referenceId={b.id}
                initialSaved={savedIds.has(b.id)}
              />
            </div>
            {/* 1:1 logo box at top - same as coupon book */}
            <div className="aspect-square w-full bg-gray-100 flex items-center justify-center shrink-0 relative">
              {b.logoUrl ? (
                <Image
                  src={b.logoUrl}
                  alt={b.name}
                  fill
                  sizes="(min-width: 1024px) 640px, (min-width: 768px) 50vw, 50vw"
                  className="object-cover"
                  quality={95}
                  unoptimized={b.logoUrl.startsWith("blob:")}
                />
              ) : (
                <span className="text-gray-400 text-sm">No logo</span>
              )}
            </div>
            {/* Business details below - same structure as coupon book */}
            <div className="p-4 flex flex-col flex-1 min-w-0">
              <h2 className="text-lg max-md:text-[0.9rem] font-bold leading-tight" style={{ color: "var(--color-heading)" }}>
                {b.name}
              </h2>
              {b.shortDescription && (
                <div className="flex-1 min-w-0 relative">
                  <div className="flex items-start gap-1">
                    <p
                      className="text-gray-600 text-sm line-clamp-2 flex-1 min-w-0"
                      title={b.shortDescription}
                    >
                      {b.shortDescription}
                    </p>
                    <button
                      type="button"
                      onClick={() => setExpandedId((id) => (id === b.id ? null : b.id))}
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
                        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                      </svg>
                    </button>
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
              {(b.address || b.city) && (
                <p className="text-gray-600 text-xs mt-1">
                  {[b.address, b.city].filter(Boolean).join(", ")}
                </p>
              )}
              <Link
                href={`/support-local/${b.slug}`}
                className="btn mt-4 w-full flex items-center justify-center text-sm py-2 px-3 min-w-0 whitespace-nowrap"
              >
                See Business!
              </Link>
            </div>
          </div>
        ))}
      </div>
      {businesses.length === 0 && (
        <p className="opacity-70">No businesses match your search or filters.</p>
      )}
    </>
  );
}
