"use client";

import { useState } from "react";
import { StorefrontGallery } from "@/components/StorefrontGallery";
import { FeaturedCarousel } from "@/components/store/FeaturedCarousel";
import { SellerSpotlight } from "@/components/store/SellerSpotlight";
import type { BrowseMeta, PublicBrowseCard, SpotlightSeller } from "@/lib/storefront-browse-data";

export function StorefrontHomeClient({
  initialSearch,
  featured,
  items,
  meta,
  spotlight,
}: {
  initialSearch: string;
  featured: PublicBrowseCard[];
  items: PublicBrowseCard[];
  meta: BrowseMeta;
  spotlight: SpotlightSeller[];
}) {
  const [search, setSearch] = useState(initialSearch);

  return (
    <>
      <section className="relative min-h-[40vh] flex flex-col items-center justify-center px-4 py-16 text-center overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: "url(/storefront-header.png)",
            filter: "brightness(1.1) contrast(1.05) saturate(1.02)",
          }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-black/35" aria-hidden />
        <div className="relative z-10 max-w-[var(--max-width)] mx-auto w-full">
          <img
            src="/nwc-hero-logo.png"
            alt="Northwest Community"
            className="mx-auto mb-5 h-36 w-36 rounded-full border-4 border-white/90 object-cover shadow-lg md:h-40 md:w-40"
          />
          <h1
            className="text-4xl md:text-5xl font-bold mb-4 text-white"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Local Business Online Shopping
          </h1>
          <p className="text-lg max-w-2xl mx-auto text-white/95 leading-relaxed mb-6">
            Welcome to the Northwest Community Store! Here you will find items from local vendors located in Eastern Washington and Northern Idaho! Shop local, without losing the comfort of shopping from your home!
          </p>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search storefront..."
            className="w-full max-w-xl mx-auto block rounded-xl px-5 py-3 text-base backdrop-blur-md bg-white/80 border border-white/40 shadow-[0_8px_32px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.5)] placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-white/50 transition-all"
            aria-label="Search storefront"
          />
        </div>
      </section>

      <section className="bg-[#f6f1eb] py-10">
        <div className="max-w-[var(--max-width)] mx-auto px-4">
          <FeaturedCarousel initialItems={featured} />
        </div>
      </section>

      <section className="py-10 pb-16">
        <StorefrontGallery
          search={search}
          onSearchChange={setSearch}
          placeholder="Search storefront..."
          initialItems={items}
          initialMeta={meta}
        />
      </section>

      <section className="bg-[#f6f1eb] py-8 pb-10">
        <div className="max-w-[var(--max-width)] mx-auto px-4">
          <SellerSpotlight initialSellers={spotlight} />
        </div>
      </section>
    </>
  );
}
