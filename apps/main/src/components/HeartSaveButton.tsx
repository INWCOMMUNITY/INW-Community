"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";

interface HeartSaveButtonProps {
  type: "event" | "business" | "coupon" | "store_item";
  referenceId: string;
  initialSaved?: boolean;
  className?: string;
  onSavedChange?: (saved: boolean) => void;
  /** Show brief “Added to Wishlist!” toast when saving (matches mobile app). */
  showWishlistToast?: boolean;
}

export function HeartSaveButton({
  type,
  referenceId,
  initialSaved = false,
  className = "",
  onSavedChange,
  showWishlistToast = type === "store_item",
}: HeartSaveButtonProps) {
  const { data: session, status } = useSession();
  const [saved, setSaved] = useState(initialSaved);
  const [loading, setLoading] = useState(false);
  const [wishlistToast, setWishlistToast] = useState(false);

  useEffect(() => {
    setSaved(initialSaved);
  }, [initialSaved]);

  useEffect(() => {
    if (!wishlistToast) return;
    const t = window.setTimeout(() => setWishlistToast(false), 3000);
    return () => window.clearTimeout(t);
  }, [wishlistToast]);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (status !== "authenticated") return;
    setLoading(true);
    try {
      if (saved) {
        const res = await fetch(
          `/api/saved?type=${encodeURIComponent(type)}&referenceId=${encodeURIComponent(referenceId)}`,
          { method: "DELETE" }
        );
        if (res.ok) {
          setSaved(false);
          onSavedChange?.(false);
        }
      } else {
        const res = await fetch("/api/saved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, referenceId }),
        });
        if (res.ok) {
          setSaved(true);
          onSavedChange?.(true);
          if (showWishlistToast) setWishlistToast(true);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  const icon = (
    <IonIcon
      name={saved ? "heart" : "heart-outline"}
      size={22}
      className={saved ? "text-red-500" : "text-gray-500"}
    />
  );

  if (status !== "authenticated") {
    return (
      <Link
        href="/login"
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-gray-100 transition text-gray-400 hover:text-red-500 ${className}`}
        title="Log in to save"
        aria-label="Log in to save"
      >
        <IonIcon name="heart-outline" size={22} className="text-gray-500" />
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={`inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-gray-100 transition disabled:opacity-50 ${className}`}
        title={saved ? "Remove from wishlist" : "Save to wishlist"}
        aria-label={saved ? "Remove from wishlist" : "Save to wishlist"}
      >
        {icon}
      </button>
      {wishlistToast && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center pointer-events-none"
          role="status"
          aria-live="polite"
        >
          <div className="bg-black/75 text-white px-6 py-3 rounded-lg shadow-lg text-sm font-medium">
            Added to Wishlist!
          </div>
        </div>
      )}
    </>
  );
}
