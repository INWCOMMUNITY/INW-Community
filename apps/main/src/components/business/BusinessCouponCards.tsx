"use client";

import { useState, useEffect } from "react";
import { CouponPopup } from "@/components/CouponPopup";

export type BusinessCouponItem = {
  id: string;
  name: string;
  discount: string;
};

export function BusinessCouponCards({ coupons }: { coupons: BusinessCouponItem[] }) {
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [couponPopupId, setCouponPopupId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/saved?type=coupon", { credentials: "include" })
      .then((r) => r.json())
      .then((items) => {
        if (Array.isArray(items)) {
          setSavedIds(new Set(items.map((i: { referenceId: string }) => i.referenceId)));
        }
      })
      .catch(() => {});
  }, []);

  if (coupons.length === 0) return null;

  return (
    <>
      <div className="flex flex-col gap-2.5">
        {coupons.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCouponPopupId(c.id)}
            className="w-full text-left p-4 rounded-lg border-2 border-[var(--color-primary)] hover:opacity-90 transition-opacity"
            style={{ backgroundColor: "#FFF8E1" }}
          >
            <p className="font-semibold text-base" style={{ color: "var(--color-heading)" }}>
              {c.name}
            </p>
            <p className="text-sm mt-0.5" style={{ color: "var(--color-text)" }}>
              {c.discount}
            </p>
          </button>
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
    </>
  );
}
