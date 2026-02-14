"use client";

import { useState, useEffect } from "react";
import { CouponPopup } from "@/components/CouponPopup";

interface CouponItem {
  id: string;
  name: string;
  discount: string;
}

interface BusinessCouponsListProps {
  coupons: CouponItem[];
}

export function BusinessCouponsList({ coupons }: BusinessCouponsListProps) {
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [couponPopupId, setCouponPopupId] = useState<string | null>(null);

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

  const handleSavedChange = (saved: boolean) => {
    if (!couponPopupId) return;
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (saved) next.add(couponPopupId);
      else next.delete(couponPopupId);
      return next;
    });
  };

  return (
    <>
      <div className="flex flex-wrap gap-3 justify-center">
        {coupons.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCouponPopupId(c.id)}
            className="btn"
          >
            {c.name} — {c.discount}
          </button>
        ))}
      </div>
      {couponPopupId && (
        <CouponPopup
          couponId={couponPopupId}
          onClose={() => setCouponPopupId(null)}
          initialSaved={savedIds.has(couponPopupId)}
          onSavedChange={handleSavedChange}
        />
      )}
    </>
  );
}
