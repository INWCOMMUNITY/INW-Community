"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

const SEARCH_DEBOUNCE_MS = 320;

export type DirectoryBusiness = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  address: string | null;
  city: string | null;
  categories: string[];
  logoUrl: string | null;
  hoursOfOperation?: Record<string, string> | null;
  directorySearchMatchNote?: "similar";
};

export function useSupportLocalDirectory() {
  const [businesses, setBusinesses] = useState<DirectoryBusiness[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [city, setCity] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [subcategoriesByPrimary, setSubcategoriesByPrimary] = useState<Record<string, string[]>>({});
  const [cities, setCities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    setSubcategory("");
  }, [category]);

  const loadMeta = useCallback(async () => {
    try {
      const res = await fetch("/api/businesses?list=meta");
      const meta = await res.json();
      if (Array.isArray(meta.categories)) setCategories(meta.categories);
      else setCategories([]);
      if (meta.subcategoriesByPrimary && typeof meta.subcategoriesByPrimary === "object") {
        setSubcategoriesByPrimary(meta.subcategoriesByPrimary);
      } else {
        setSubcategoriesByPrimary({});
      }
      if (Array.isArray(meta.cities)) setCities(meta.cities);
      else setCities([]);
    } catch {
      /* ignore meta errors — matches app */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setConnectionError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (category) params.set("category", category);
      if (category && subcategory) params.set("subcategory", subcategory);
      if (city) params.set("city", city);
      const res = await fetch(`/api/businesses?${params}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to load.");
      }
      setBusinesses(Array.isArray(data) ? data : []);
    } catch (e) {
      setBusinesses([]);
      setConnectionError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, category, subcategory, city]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void load();
  }, [load]);

  const searchLower = search.trim().toLowerCase();
  const subsForPrimary = category ? (subcategoriesByPrimary[category] ?? []) : [];

  const filteredCategories = useMemo(
    () =>
      searchLower ? categories.filter((c) => c.toLowerCase().includes(searchLower)) : categories,
    [categories, searchLower]
  );

  const filteredSubcategories = useMemo(
    () =>
      searchLower ? subsForPrimary.filter((s) => s.toLowerCase().includes(searchLower)) : subsForPrimary,
    [subsForPrimary, searchLower]
  );

  const hasActiveFilters = Boolean(search || category || subcategory || city);

  const emptyMessage = hasActiveFilters
    ? "No businesses found. Try different filters."
    : "No businesses found.";

  return {
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
    categories,
    filteredCategories,
    filteredSubcategories,
    subsForPrimary,
    loading,
    connectionError,
    load,
    hasActiveFilters,
    emptyMessage,
  };
}
