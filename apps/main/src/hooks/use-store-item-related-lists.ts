"use client";

import { useEffect, useState } from "react";

type RelatedItem = {
  id: string;
  title: string;
  slug: string;
  photos: string[];
  priceCents: number;
};

/**
 * Loads “more from seller” and “similar items” after the main listing paint
 * so the product page feels responsive on first load.
 */
export function useStoreItemRelatedLists(
  item: {
    id?: string;
    category?: string | null;
    member?: { id: string } | null;
  } | null
) {
  const [sellerItems, setSellerItems] = useState<RelatedItem[]>([]);
  const [similarItems, setSimilarItems] = useState<RelatedItem[]>([]);

  useEffect(() => {
    if (!item?.id) {
      setSellerItems([]);
      setSimilarItems([]);
      return;
    }

    let cancelled = false;
    const memberId = item.member?.id;

    const load = () => {
      if (cancelled) return;

      if (memberId) {
        const sellerParams = new URLSearchParams({
          memberId,
          excludeId: item.id!,
        });
        fetch(`/api/store-items?${sellerParams}`)
          .then((r) => r.json())
          .then((data) => {
            if (!cancelled) setSellerItems(Array.isArray(data) ? data : []);
          })
          .catch(() => {
            if (!cancelled) setSellerItems([]);
          });
      } else {
        setSellerItems([]);
      }

      const similarParams = new URLSearchParams({ excludeId: item.id! });
      if (item.category) similarParams.set("category", item.category);
      fetch(`/api/store-items?${similarParams}`)
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled) setSimilarItems(Array.isArray(data) ? data : []);
        })
        .catch(() => {
          if (!cancelled) setSimilarItems([]);
        });
    };

    const idleId =
      typeof requestIdleCallback !== "undefined"
        ? requestIdleCallback(load, { timeout: 2000 })
        : null;
    const timeoutId = idleId == null ? window.setTimeout(load, 150) : null;

    return () => {
      cancelled = true;
      if (idleId != null && typeof cancelIdleCallback !== "undefined") {
        cancelIdleCallback(idleId);
      }
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [item?.id, item?.category, item?.member?.id]);

  return { sellerItems, similarItems };
}
