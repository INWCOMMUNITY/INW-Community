"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { ThemeSelect } from "@/components/ThemeSelect";

interface Seller {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  address: string | null;
  city: string | null;
  categories: string[];
  logoUrl: string | null;
  coverPhotoUrl?: string | null;
  itemCount: number;
}

export function NWCSellersGallery() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/sellers?list=meta")
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
    fetch(`/api/sellers?${params}`)
      .then((r) => r.json())
      .then((d) => setSellers(Array.isArray(d) ? d : []));
  }, [search, category, city]);

  return (
    <>
      <div className="mb-8 rounded-lg border-2 border-[var(--color-secondary)] p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1">Search sellers</label>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, city, category..."
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-secondary)] focus:border-[var(--color-secondary)] hover:border-[var(--color-secondary)]"
              aria-label="Search sellers"
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
        {sellers.map((s) => (
          <Link
            key={s.id}
            href={`/support-local/sellers/${s.slug}`}
            className="border-2 border-[var(--color-primary)] rounded-lg overflow-hidden transition relative flex flex-col w-full max-w-[320px] hover:opacity-95"
          >
            <div className="aspect-square w-full bg-gray-100 flex items-center justify-center shrink-0 relative">
              {s.logoUrl ? (
                <Image
                  src={s.logoUrl}
                  alt={s.name}
                  fill
                  sizes="(min-width: 1024px) 320px, (min-width: 768px) 50vw, 50vw"
                  className="object-cover"
                  quality={95}
                  unoptimized={s.logoUrl.startsWith("blob:")}
                />
              ) : (
                <span className="text-gray-400 text-sm">No logo</span>
              )}
            </div>
            <div className="p-4 flex flex-col flex-1 min-w-0">
              <h2 className="text-lg max-md:text-[0.9rem] font-bold leading-tight" style={{ color: "var(--color-heading)" }}>
                {s.name}
              </h2>
              {s.shortDescription && (
                <p className="text-gray-600 text-sm line-clamp-2 mt-1">{s.shortDescription}</p>
              )}
              {(s.address || s.city) && (
                <p className="text-gray-600 text-xs mt-1">
                  {[s.address, s.city].filter(Boolean).join(", ")}
                </p>
              )}
              {s.itemCount > 0 && (
                <p className="text-gray-500 text-xs mt-1">{s.itemCount} items</p>
              )}
              <span className="btn mt-4 w-full flex items-center justify-center text-sm py-2 px-3 min-w-0 whitespace-nowrap">
                View Store
              </span>
            </div>
          </Link>
        ))}
      </div>
      {sellers.length === 0 && (
        <p className="opacity-70">No sellers match your search or filters.</p>
      )}
    </>
  );
}
