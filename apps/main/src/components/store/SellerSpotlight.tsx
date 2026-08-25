"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { IonIcon } from "@/components/IonIcon";
import { CARD_RADIUS, CARD_SHADOW } from "@/components/ui/card-styles";

interface SpotlightSeller {
  memberId: string;
  name: string;
  logoUrl: string | null;
  businessSlug: string | null;
  itemCount: number;
  memberSince: number;
}

export function SellerSpotlight({ initialSellers }: { initialSellers?: SpotlightSeller[] }) {
  const [sellers, setSellers] = useState<SpotlightSeller[]>(initialSellers ?? []);
  const [loading, setLoading] = useState(!initialSellers);

  useEffect(() => {
    if (initialSellers) return;
    fetch("/api/store-items?sellerSpotlight=1&limit=12")
      .then((r) => r.json())
      .then((data) => {
        // API returns array directly, filter to only sellers with a business slug
        const allSellers = Array.isArray(data) ? data : [];
        setSellers(allSellers.filter((s: SpotlightSeller) => s.businessSlug));
      })
      .catch(() => setSellers([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <section>
        <h2 className="text-2xl font-bold mb-6 text-center">Shop by Seller</h2>
        <div className="flex gap-5 overflow-hidden">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className={`shrink-0 w-[160px] sm:w-[180px] ${CARD_RADIUS} ${CARD_SHADOW} bg-white p-4 text-center`}>
              <div className="w-20 h-20 mx-auto rounded-full bg-gray-200 animate-pulse" />
              <div className="mt-3 space-y-2">
                <div className="h-4 w-3/4 mx-auto bg-gray-200 animate-pulse rounded" />
                <div className="h-3 w-1/2 mx-auto bg-gray-200 animate-pulse rounded" />
                <div className="h-3 w-2/3 mx-auto bg-gray-200 animate-pulse rounded" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (sellers.length === 0) return null;

  return (
    <section>
      {/* Decorative section header */}
      <div className="flex items-center gap-4 mb-3 px-1">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[var(--color-primary)]/30 to-transparent" />
        <h2 className="text-2xl font-bold tracking-wide">Shop by Seller</h2>
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[var(--color-primary)]/30 to-transparent" />
      </div>
      <p className="text-center text-gray-600 mb-6">Browse items from our local vendors</p>
      <div
        className="-mx-4 flex gap-5 overflow-x-auto px-4 pb-2 scrollbar-hide"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {sellers.map((seller) => (
          <Link
            key={seller.memberId}
            href={seller.businessSlug ? `/support-local/sellers/${seller.businessSlug}` : "#"}
            className={`shrink-0 w-[160px] sm:w-[180px] ${CARD_RADIUS} ${CARD_SHADOW} bg-white p-4 text-center transition-all duration-300 hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(80,85,66,0.15)]`}
          >
            <div className="w-20 h-20 mx-auto rounded-full bg-[#f5f5f5] relative overflow-hidden">
              {seller.logoUrl ? (
                <Image
                  src={seller.logoUrl}
                  alt={seller.name}
                  fill
                  className="object-cover"
                  sizes="80px"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <IonIcon name="storefront-outline" size={32} className="text-[#999]" />
                </div>
              )}
            </div>
            <h3 className="font-semibold text-base leading-tight mt-3 line-clamp-2">{seller.name}</h3>
            <p className="text-xs text-gray-500 mt-1">
              Seller since {seller.memberSince}
            </p>
            <p className="text-sm text-[var(--color-primary)] font-medium mt-1">
              {seller.itemCount} {seller.itemCount === 1 ? "item" : "items"}
            </p>
          </Link>
        ))}
      </div>
      <div className="text-center mt-5">
        <Link
          href="/support-local/sellers"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full border-2 border-[var(--color-primary)] text-[var(--color-primary)] font-semibold hover:bg-[var(--color-primary)] hover:text-white transition"
        >
          View All Sellers
          <IonIcon name="arrow-forward" size={18} />
        </Link>
      </div>
    </section>
  );
}
