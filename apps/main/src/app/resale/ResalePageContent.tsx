"use client";

import { useState } from "react";
import { StorefrontGallery } from "@/components/StorefrontGallery";
import { ResalePageActions } from "@/components/ResalePageActions";

export function ResalePageContent({ canList, isSeller }: { canList: boolean; isSeller: boolean }) {
  const [search, setSearch] = useState("");

  return (
    <>
      <section className="relative min-h-[40vh] flex flex-col items-center justify-center px-4 py-16 text-center overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: "url(/storefront-header.png)",
            filter: "brightness(0.95) contrast(1.05) saturate(0.98)",
          }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-black/40" aria-hidden />
        <div className="relative z-10 max-w-[var(--max-width)] mx-auto w-full">
          <h1
            className="text-4xl md:text-5xl font-bold mb-4 text-white"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Community Resale
          </h1>
          <p className="text-lg max-w-2xl mx-auto text-white/95 leading-relaxed mb-6">
            Buy and sell pre-loved local goods. Give items a second life and support your community.
          </p>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search resale..."
            className="w-full max-w-xl mx-auto block border-2 rounded-lg px-4 py-2.5 text-sm shadow-sm bg-white/95 mb-6"
            style={{ borderColor: "var(--color-primary)" }}
            aria-label="Search resale"
          />
          <ResalePageActions canList={canList} isSeller={isSeller} />
        </div>
      </section>
      <section className="py-12 pb-20 px-4" style={{ padding: "var(--section-padding)", paddingTop: "1.5rem" }}>
        <StorefrontGallery
          listingType="resale"
          basePath="/resale"
          storageKey="resaleFilters"
          placeholder="Search resale..."
          search={search}
          onSearchChange={setSearch}
        />
      </section>
    </>
  );
}
