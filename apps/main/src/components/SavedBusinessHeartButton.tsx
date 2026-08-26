"use client";

import { useEffect, useState } from "react";
import { IonIcon } from "@/components/IonIcon";

export function SavedBusinessHeartButton({
  referenceId,
  className = "",
}: {
  referenceId: string;
  className?: string;
}) {
  const [saved, setSaved] = useState(true);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(false), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    try {
      if (saved) {
        const res = await fetch(
          `/api/saved?type=business&referenceId=${encodeURIComponent(referenceId)}`,
          { method: "DELETE" }
        );
        if (res.ok) {
          setSaved(false);
          setToast(true);
        }
      } else {
        const res = await fetch("/api/saved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "business", referenceId }),
        });
        if (res.ok) setSaved(true);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        aria-label={saved ? "Unsave business" : "Save business"}
        title={saved ? "Unsave" : "Save"}
        className={`z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--color-primary)] bg-white text-[var(--color-primary)] hover:bg-[var(--color-section-alt)] disabled:opacity-50 ${className}`}
      >
        <IonIcon
          name={saved ? "heart" : "heart-outline"}
          size={18}
          className="text-[var(--color-primary)]"
        />
      </button>
      {toast ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center pointer-events-none"
          role="status"
          aria-live="polite"
        >
          <div className="bg-black/75 text-white px-6 py-3 rounded-lg shadow-lg text-sm font-medium">
            Removed from My Businesses
          </div>
        </div>
      ) : null}
    </>
  );
}
