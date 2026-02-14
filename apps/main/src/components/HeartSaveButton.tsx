"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface HeartSaveButtonProps {
  type: "event" | "business" | "coupon" | "store_item";
  referenceId: string;
  initialSaved?: boolean;
  className?: string;
  onSavedChange?: (saved: boolean) => void;
}

export function HeartSaveButton({
  type,
  referenceId,
  initialSaved = false,
  className = "",
  onSavedChange,
}: HeartSaveButtonProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSaved(initialSaved);
  }, [initialSaved]);

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
          setTimeout(() => router.refresh(), 100);
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
          setTimeout(() => router.refresh(), 100);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  if (status !== "authenticated") {
    return (
      <Link
        href="/login"
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-gray-100 transition text-gray-400 hover:text-red-500 ${className}`}
        title="Log in to save"
        aria-label="Log in to save"
      >
        <HeartIcon filled={false} />
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-gray-100 transition disabled:opacity-50 ${
        saved ? "text-red-500" : "text-gray-400 hover:text-red-500"
      } ${className}`}
      title={saved ? "Remove from favorites" : "Save to favorites"}
      aria-label={saved ? "Remove from favorites" : "Save to favorites"}
    >
      <HeartIcon filled={saved} />
    </button>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
