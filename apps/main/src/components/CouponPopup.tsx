"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { HeartSaveButton } from "@/components/HeartSaveButton";

/** Coupon background (excludes photo box and code box) */
const TAN_BG = "#f8e7c9";
const DARK_GREEN = "#3A624E";

interface CouponPopupProps {
  couponId: string;
  onClose: () => void;
  initialSaved?: boolean;
  onSavedChange?: (saved: boolean) => void;
}

interface CouponData {
  id: string;
  name: string;
  discount: string;
  code: string | null;
  imageUrl: string | null;
  business: { name: string; address: string | null; city: string | null; phone: string | null } | null;
  hasAccess: boolean;
}

export function CouponPopup({ couponId, onClose, initialSaved, onSavedChange }: CouponPopupProps) {
  const [data, setData] = useState<CouponData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/coupons/${couponId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Coupon not found");
        return r.json();
      })
      .then(setData)
      .catch(() => setError("Could not load coupon"))
      .finally(() => setLoading(false));
  }, [couponId]);

  useLockBodyScroll(true);

  if (loading) {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50" aria-modal="true" role="dialog">
        <div className="rounded-xl shadow-xl p-8 max-w-md w-full text-center" style={{ backgroundColor: TAN_BG, border: `3px solid ${DARK_GREEN}` }}>
          <p className="text-gray-600">Loading coupon…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50" aria-modal="true" role="dialog" onClick={onClose}>
        <div className="rounded-xl shadow-xl p-6 max-w-md w-full text-center" style={{ backgroundColor: TAN_BG, border: `3px solid ${DARK_GREEN}` }} onClick={(e) => e.stopPropagation()}>
          <p className="text-gray-700 mb-4">{error ?? "Coupon not found."}</p>
          <button type="button" onClick={onClose} className="btn" style={{ borderColor: DARK_GREEN, color: DARK_GREEN, backgroundColor: "white" }}>Close</button>
        </div>
      </div>
    );
  }

  // Subscriber gate
  if (!data.hasAccess) {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50" aria-modal="true" role="dialog" onClick={onClose}>
        <div
          className="rounded-xl shadow-xl p-8 max-w-md w-full text-center"
          style={{ backgroundColor: TAN_BG, border: `3px solid ${DARK_GREEN}` }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-lg font-semibold mb-2" style={{ color: DARK_GREEN, fontFamily: "var(--font-heading)" }}>
            Sorry, Coupons are only available to Northwest Community Subscribers
          </p>
          <p className="text-gray-700 text-base mb-6" style={{ fontFamily: "var(--font-body)" }}>
            Subscribe to view and save coupons from local businesses.
          </p>
          <Link href="/support-nwc" className="btn inline-block text-white hover:text-white" style={{ backgroundColor: DARK_GREEN }} onClick={onClose}>
            Sign up
          </Link>
          <button type="button" onClick={onClose} className="block mt-4 text-base underline" style={{ color: DARK_GREEN }}>Close</button>
        </div>
      </div>
    );
  }

  const address = data.business?.address ?? (data.business?.city ? data.business.city : null);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 overflow-hidden"
      aria-modal="true"
      role="dialog"
      aria-labelledby="coupon-popup-title"
      onClick={onClose}
    >
      <div
        className="relative rounded-xl shadow-xl w-full max-w-[493px] overflow-hidden flex flex-col max-h-[90vh]"
        style={{ backgroundColor: TAN_BG, border: `3px solid ${DARK_GREEN}`, fontFamily: "var(--font-body)", fontWeight: "var(--font-body-weight, 300)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center text-gray-600 hover:bg-black/10"
          aria-label="Close"
        >
          <span className="text-xl leading-none">×</span>
        </button>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 min-h-0">
        {/* NWC Logo – no box, same tan as coupon background */}
        <div className="flex justify-center pt-6 pb-2">
          <div className="relative w-40 h-40 shrink-0">
            <Image src="/nwc-logo-coupon.png" alt="Northwest Community" fill className="object-contain object-center" sizes="160px" unoptimized />
          </div>
        </div>

        {/* Business name then coupon name */}
        {data.business?.name && (
          <p className="text-center text-base px-4 pb-0.5" style={{ fontFamily: "var(--font-body)", color: DARK_GREEN }}>
            {data.business.name}
          </p>
        )}
        <h2 id="coupon-popup-title" className="text-center text-xl font-bold px-4 pb-1" style={{ color: DARK_GREEN, fontFamily: "var(--font-heading)" }}>
          {data.name}
        </h2>

        {/* Discount / offer */}
        <p className="text-center text-base px-4 pb-4 text-gray-800" style={{ fontFamily: "var(--font-body)" }}>
          {data.discount}
        </p>

        {/* Central image (QR / barcode / logo) */}
        <div className="px-4 pb-4">
          <div
            className="w-full rounded-lg overflow-hidden flex items-center justify-center min-h-[180px] bg-white"
            style={{ border: `3px solid ${DARK_GREEN}` }}
          >
            {data.imageUrl ? (
              <img src={data.imageUrl} alt={data.name} className="w-full h-auto max-h-[240px] object-contain" />
            ) : (
              <span className="text-gray-500 text-base p-4">No image</span>
            )}
          </div>
        </div>

        {/* Redeemed at / Address */}
        {address && (
          <div className="px-4 pb-2" style={{ fontFamily: "var(--font-body)" }}>
            <p className="text-center text-base font-medium" style={{ color: DARK_GREEN, fontFamily: "var(--font-heading)" }}>Redeemed at</p>
            <p className="text-center text-base text-gray-800">{address}</p>
          </div>
        )}

        {/* Coupon code */}
        {data.code && (
          <div className="px-4 pb-6" style={{ fontFamily: "var(--font-body)" }}>
            <div className="rounded-lg py-3 px-4 text-center bg-white" style={{ border: `2px solid ${DARK_GREEN}` }}>
              <p className="text-base font-medium mb-0.5" style={{ color: DARK_GREEN, fontFamily: "var(--font-heading)" }}>Code</p>
              <p className="text-lg font-bold" style={{ color: DARK_GREEN }}>{data.code}</p>
            </div>
          </div>
        )}

        {/* Save favorite */}
        <div className="px-4 pb-6 flex justify-center">
          <HeartSaveButton type="coupon" referenceId={data.id} initialSaved={initialSaved} onSavedChange={onSavedChange} className="text-base" />
        </div>
        </div>
      </div>
    </div>
  );
}
