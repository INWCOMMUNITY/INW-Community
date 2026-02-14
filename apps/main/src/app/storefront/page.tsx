"use client";

import { useState } from "react";
import { StorefrontGallery } from "@/components/StorefrontGallery";

export default function StorefrontPage() {
  const [search, setSearch] = useState("");

  return (
    <>
      {/* Header: storefront photo */}
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
          <h1
            className="text-4xl md:text-5xl font-bold mb-4 text-white"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            NWC Storefront
          </h1>
          <p className="text-lg max-w-2xl mx-auto text-white/95 leading-relaxed mb-6">
            Welcome to the Northwest Community Store! Here you will find items from local vendors located in Eastern Washington and Northern Idaho! Shop local, without losing the comfort of shopping from your home!
          </p>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search storefront..."
            className="w-full max-w-xl mx-auto block border-2 rounded-lg px-4 py-2.5 text-sm shadow-sm bg-white/95"
            style={{ borderColor: "var(--color-primary)" }}
            aria-label="Search storefront"
          />
        </div>
      </section>
      <section className="py-12 pb-20 px-4" style={{ padding: "var(--section-padding)", paddingTop: "1.5rem" }}>
        <StorefrontGallery search={search} onSearchChange={setSearch} placeholder="Search storefront..." />
      </section>
    </>
  );
}
