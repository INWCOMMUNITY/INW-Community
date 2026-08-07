"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { IonIcon } from "@/components/IonIcon";
import { CARD_RADIUS, CARD_SHADOW } from "@/components/ui/card-styles";

interface FeaturedItem {
  id: string;
  slug: string;
  title: string;
  photos: string[];
  priceCents: number;
  business?: { name: string; slug: string } | null;
}

export function FeaturedCarousel() {
  const [items, setItems] = useState<FeaturedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/store-items?featured=1&limit=20")
      .then((r) => r.json())
      .then((data) => {
        // API returns array directly, not { items: [] }
        setItems(Array.isArray(data) ? data : []);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const scrollTo = (index: number) => {
    if (!scrollRef.current) return;
    const item = scrollRef.current.children[index] as HTMLElement | undefined;
    if (item) {
      item.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
      setCurrentIndex(index);
    }
  };

  if (loading) {
    return (
      <section className="mb-8">
        <h2 className="text-xl font-bold mb-4 px-1">Featured</h2>
        <div className="flex gap-5 overflow-hidden">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="shrink-0 w-[200px] sm:w-[240px]">
              <div className={`${CARD_RADIUS} ${CARD_SHADOW} bg-white overflow-hidden`}>
                <div className="aspect-[4/5] bg-gray-200 animate-pulse" />
                <div className="p-3.5 space-y-2">
                  <div className="h-4 w-3/4 bg-gray-200 animate-pulse rounded" />
                  <div className="h-4 w-1/2 bg-gray-200 animate-pulse rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="mb-8">
      {/* Decorative section header */}
      <div className="flex items-center gap-4 mb-6 px-1">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[var(--color-primary)]/30 to-transparent" />
        <h2 className="text-2xl font-bold tracking-wide">Featured</h2>
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[var(--color-primary)]/30 to-transparent" />
      </div>
      <div className="flex items-center justify-end mb-4 px-1">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => scrollTo(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
            className="p-1.5 rounded-full hover:bg-gray-100 disabled:opacity-40"
            aria-label="Previous"
          >
            <IonIcon name="chevron-back" size={20} />
          </button>
          <button
            type="button"
            onClick={() => scrollTo(Math.min(items.length - 1, currentIndex + 1))}
            disabled={currentIndex >= items.length - 1}
            className="p-1.5 rounded-full hover:bg-gray-100 disabled:opacity-40"
            aria-label="Next"
          >
            <IonIcon name="chevron-forward" size={20} />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="-mx-4 flex gap-5 overflow-x-auto px-4 pb-2 snap-x snap-mandatory scrollbar-hide"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/storefront/${item.slug}`}
            className={`group shrink-0 w-[200px] sm:w-[240px] snap-start ${CARD_RADIUS} ${CARD_SHADOW} bg-white overflow-hidden transition-all duration-300 hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(80,85,66,0.15)]`}
          >
            <div className="aspect-[4/5] bg-[#f5f5f5] relative overflow-hidden">
              {item.photos[0] ? (
                <Image
                  src={item.photos[0]}
                  alt={item.title}
                  fill
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                  sizes="(max-width: 640px) 200px, 240px"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <IonIcon name="image-outline" size={36} className="text-[#999]" />
                </div>
              )}
              {/* Price ribbon tag */}
              <div className="absolute bottom-2 left-0 bg-[var(--color-primary)] text-white text-sm font-bold px-3 py-1 rounded-r-md shadow-md">
                ${(item.priceCents / 100).toFixed(2)}
              </div>
            </div>
            <div className="p-3.5">
              <h3 className="text-base font-medium leading-tight line-clamp-2">{item.title}</h3>
              {item.business && (
                <p className="text-sm text-gray-500 truncate mt-1">{item.business.name}</p>
              )}
            </div>
          </Link>
        ))}
      </div>
      {/* Dot indicators */}
      {items.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-3">
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => scrollTo(i)}
              className={`w-2 h-2 rounded-full transition ${
                i === currentIndex ? "bg-[var(--color-primary)]" : "bg-gray-300"
              }`}
              aria-label={`Go to item ${i + 1}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
