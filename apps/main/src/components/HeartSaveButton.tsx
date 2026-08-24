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
  iconSize?: number;
  /** Icon-only (default) or full-width labeled button (business page). */
  variant?: "icon" | "full";
  /** Full-width pill color. Ghost is a quieter rectangular control for buy boxes. */
  tone?: "primary" | "earth" | "tan" | "ghost";
  saveLabel?: string;
  savedLabel?: string;
  onSavedChange?: (saved: boolean) => void;
  /** Show brief "Added to Wishlist!" toast when saving (matches mobile app). */
  showWishlistToast?: boolean;
  /** Override icon color class (e.g., "text-white" for green button backgrounds). */
  iconClassName?: string;
}

export function HeartSaveButton({
  type,
  referenceId,
  initialSaved = false,
  className = "",
  iconSize = 22,
  variant = "icon",
  tone = "primary",
  saveLabel = "Save",
  savedLabel = "Saved",
  onSavedChange,
  showWishlistToast = type === "store_item",
  iconClassName,
}: HeartSaveButtonProps) {
  const { data: session, status } = useSession();
  const [saved, setSaved] = useState(initialSaved);
  const [loading, setLoading] = useState(false);
  const [wishlistToast, setWishlistToast] = useState(false);
  const [pulseAnimation, setPulseAnimation] = useState(false);

  useEffect(() => {
    setSaved(initialSaved);
  }, [initialSaved]);

  useEffect(() => {
    if (!wishlistToast) return;
    const t = window.setTimeout(() => setWishlistToast(false), 3000);
    return () => window.clearTimeout(t);
  }, [wishlistToast]);

  // Clear pulse animation after it plays
  useEffect(() => {
    if (!pulseAnimation) return;
    const t = window.setTimeout(() => setPulseAnimation(false), 300);
    return () => window.clearTimeout(t);
  }, [pulseAnimation]);

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
          setPulseAnimation(true);
          if (showWishlistToast) setWishlistToast(true);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  const isFull = variant === "full";
  const isGhost = isFull && tone === "ghost";
  const toneClass =
    tone === "tan"
      ? "btn-pill-tan"
      : tone === "earth"
        ? "btn-pill-earth"
        : tone === "ghost"
          ? "btn-pill-ghost"
          : "btn-pill-primary";
  const fullIconClass = isGhost
    ? saved
      ? "text-red-500"
      : "text-[var(--color-primary)]"
    : tone === "tan"
      ? "text-[var(--color-earth)]"
      : "text-white";
  const defaultIconClass = saved ? (isFull ? fullIconClass : "text-red-500") : isFull ? fullIconClass : "text-gray-500";
  const iconClass = iconClassName || defaultIconClass;
  const icon = (
    <span className={`inline-flex items-center justify-center ${pulseAnimation ? "animate-heart-pulse" : ""}`}>
      <IonIcon
        name={saved ? "heart" : "heart-outline"}
        size={iconSize}
        className={iconClass}
      />
    </span>
  );
  const label = saved ? savedLabel : saveLabel;
  const fullBtnClass =
    tone === "tan"
      ? `inline-flex w-full items-center justify-center gap-2.5 rounded bg-[var(--color-section-alt)] px-4 py-2.5 font-medium text-[var(--color-earth)] transition-colors hover:bg-[#f5d9a8] disabled:opacity-50 ${className}`
      : isGhost
        ? `inline-flex w-full items-center justify-center gap-2.5 rounded border border-[#E6D8B7] bg-transparent px-4 py-2.5 font-medium text-[var(--color-heading)] transition-colors hover:bg-white disabled:opacity-50 ${className}`
        : `action-pill ${toneClass} action-pill-lg w-full min-w-0 flex-1 py-3 text-[15px] font-bold shadow-sm disabled:opacity-50 ${className}`;
  const iconBtnClass = `inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-gray-100 transition disabled:opacity-50 ${className}`;

  if (status !== "authenticated") {
    if (isFull) {
      return (
        <Link
          href="/login"
          onClick={(e) => e.stopPropagation()}
          className={fullBtnClass}
          title="Log in to save"
        >
          <IonIcon name="heart-outline" size={iconSize} className={iconClassName || fullIconClass} />
          <span>{saveLabel}</span>
        </Link>
      );
    }
    return (
      <Link
        href="/login"
        onClick={(e) => e.stopPropagation()}
        className={`${iconBtnClass} text-gray-400 hover:text-red-500`}
        title="Log in to save"
        aria-label="Log in to save"
      >
        <IonIcon name="heart-outline" size={iconSize} className={iconClassName || "text-gray-500"} />
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={isFull ? fullBtnClass : iconBtnClass}
        title={saved ? "Remove from wishlist" : "Save to wishlist"}
        aria-label={isFull ? label : saved ? "Remove from wishlist" : "Save to wishlist"}
      >
        {icon}
        {isFull ? <span>{label}</span> : null}
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
