"use client";

import { useState } from "react";
import Link from "next/link";
import { listingDescriptionPreview } from "@/lib/channels/rich-description";
import { HeartSaveButton } from "@/components/HeartSaveButton";
import { ShareButton } from "@/components/ShareButton";
import { CARD_RADIUS, CARD_SHADOW } from "@/components/ui/card-styles";

export type StorefrontCardItem = {
  id: string;
  title: string;
  slug: string;
  description?: string | null;
  photos: string[];
  priceCents: number;
  business?: { name: string; slug: string } | null;
};

export function StorefrontCard({
  item,
  savedIds,
  basePath = "/storefront",
  productHref,
  showBusiness = true,
}: {
  item: StorefrontCardItem;
  savedIds: Set<string>;
  basePath?: string;
  productHref?: string;
  showBusiness?: boolean;
}) {
  const [hoveredPhotoIndex, setHoveredPhotoIndex] = useState(0);
  const href = productHref ?? `${basePath}/${item.slug}`;
  const photoUrl = item.photos.length > 0 ? item.photos[hoveredPhotoIndex % item.photos.length] : null;

  return (
    <div
      className={`group border-2 border-[var(--color-primary)] ${CARD_RADIUS} ${CARD_SHADOW} overflow-hidden relative bg-white transition-all duration-300 hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(80,85,66,0.15)]`}
    >
      <Link
        href={href}
        onMouseEnter={() => {
          if (item.photos.length > 1) {
            setHoveredPhotoIndex((i) => (i + 1) % item.photos.length);
          }
        }}
        onMouseLeave={() => setHoveredPhotoIndex(0)}
        className="block aspect-square w-full relative bg-[#F8F8F3] p-2 border-b-2 border-[var(--color-primary)] overflow-hidden"
      >
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={item.title}
            className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center opacity-60 text-xs"
            style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-text)" }}
          >
            No image
          </div>
        )}
        <div className="absolute bottom-2 left-0 bg-[var(--color-primary)] text-white text-sm font-bold px-3 py-1 rounded-r-md shadow-md">
          ${(item.priceCents / 100).toFixed(2)}
        </div>
      </Link>
      <div className="p-2.5">
        <h2 className="text-sm font-bold leading-tight line-clamp-2">
          <Link href={href} className="hover:underline">
            {item.title}
          </Link>
        </h2>
        {showBusiness && item.business ? (
          <Link
            href={`/support-local/${item.business.slug}`}
            className="text-xs hover:underline block truncate"
            style={{ color: "var(--color-link)" }}
          >
            {item.business.name}
          </Link>
        ) : null}
        {item.description ? (
          <p className="text-xs text-gray-600 mt-1 line-clamp-2">
            {listingDescriptionPreview(item.description)}
          </p>
        ) : null}
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
          <div className="flex gap-1.5">
            <HeartSaveButton
              type="store_item"
              referenceId={item.id}
              initialSaved={savedIds.has(item.id)}
              className="card-action-btn"
              iconSize={16}
              iconClassName="card-action-icon"
            />
            <ShareButton
              type="store_item"
              id={item.id}
              slug={item.slug}
              title={item.title}
              className="card-action-btn"
              iconSize={16}
              iconClassName="card-action-icon"
            />
          </div>
          <Link href={href} className="text-xs font-medium text-[var(--color-primary)] hover:underline">
            View details →
          </Link>
        </div>
      </div>
    </div>
  );
}
