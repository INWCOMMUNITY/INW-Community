"use client";

import { useState, useEffect } from "react";
import { HeartSaveButton } from "@/components/HeartSaveButton";
import { CouponPopup } from "@/components/CouponPopup";
import { ThemeSelect } from "@/components/ThemeSelect";

interface CouponItem {
  id: string;
  name: string;
  discount: string;
  imageUrl: string | null;
  business: { name: string; city: string | null; categories: string[]; logoUrl: string | null } | null;
}

export function CouponBookGallery() {
  const [coupons, setCoupons] = useState<CouponItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [couponPopupId, setCouponPopupId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/coupons/list?list=meta")
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
    fetch(`/api/coupons/list?${params}`)
      .then((r) => r.json())
      .then((d) => setCoupons(Array.isArray(d) ? d : []));
  }, [search, category, city]);

  useEffect(() => {
    fetch("/api/saved?type=coupon")
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
            <label className="block text-sm font-medium mb-1">Search coupons</label>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by coupon name, discount, or business..."
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-secondary)] focus:border-[var(--color-secondary)] hover:border-[var(--color-secondary)]"
              aria-label="Search coupons"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Coupon Category</label>
            <ThemeSelect
              value={category}
              onChange={setCategory}
              options={categories}
              placeholder="All"
              aria-label="Coupon category filter"
              className="min-w-[160px]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Location</label>
            <ThemeSelect
              value={city}
              onChange={setCity}
              options={cities}
              placeholder="All"
              aria-label="Location filter"
              className="min-w-[160px]"
            />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 justify-items-center">
        {coupons.map((c) => (
          <div key={c.id} className="border-2 border-[var(--color-primary)] rounded-lg overflow-hidden transition relative flex flex-col w-full max-w-[320px]">
            <div className="absolute top-2 right-2 z-10">
              <HeartSaveButton
                type="coupon"
                referenceId={c.id}
                initialSaved={savedIds.has(c.id)}
              />
            </div>
            {/* 1:1 logo box at top */}
            <div className="aspect-square w-full bg-gray-100 flex items-center justify-center shrink-0">
              {c.business?.logoUrl ? (
                <img src={c.business.logoUrl} alt={c.business.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-gray-400 text-sm">No logo</span>
              )}
            </div>
            {/* Sponsor coupon details below */}
            <div className="p-4 flex flex-col flex-1 min-w-0">
              {c.business && (
                <p className="text-sm font-medium text-[var(--color-heading)]">{c.business.name}</p>
              )}
              <h2 className="text-lg max-md:text-[0.9rem] font-bold">{c.name}</h2>
              <p className="text-gray-600 text-sm flex-1">{c.discount}</p>
              {c.imageUrl && (
                <img src={c.imageUrl} alt={c.name} className="w-full h-24 object-cover rounded mt-2" />
              )}
              <button
                type="button"
                onClick={() => setCouponPopupId(c.id)}
                className="btn mt-4 w-full text-center text-sm py-2 px-3 min-w-0"
              >
                See coupon
              </button>
            </div>
          </div>
        ))}
      </div>
      {couponPopupId && (
        <CouponPopup
          couponId={couponPopupId}
          onClose={() => setCouponPopupId(null)}
          initialSaved={savedIds.has(couponPopupId)}
          onSavedChange={(saved) => {
            setSavedIds((prev) => {
              const next = new Set(prev);
              if (saved) next.add(couponPopupId);
              else next.delete(couponPopupId);
              return next;
            });
          }}
        />
      )}
      {coupons.length === 0 && (
        <p className="text-gray-500">No coupons match your filters.</p>
      )}
    </>
  );
}
