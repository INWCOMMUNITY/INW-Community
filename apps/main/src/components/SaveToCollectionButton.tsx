"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { IonIcon } from "@/components/IonIcon";
import { AddToCollectionModal } from "@/components/AddToCollectionModal";

type Props = {
  storeItemId: string;
  storeItemTitle: string;
  className?: string;
  iconSize?: number;
  iconClassName?: string;
  /** Icon-only card control, or a full-width labeled button on the listing page. */
  variant?: "icon" | "full";
  label?: string;
};

/** Bookmark control that opens Add to collection. */
export function SaveToCollectionButton({
  storeItemId,
  storeItemTitle,
  className = "",
  iconSize = 16,
  iconClassName = "card-action-icon",
  variant = "icon",
  label = "Add to Collection",
}: Props) {
  const { status } = useSession();
  const [open, setOpen] = useState(false);
  const isFull = variant === "full";
  const fullClass = `inline-flex w-full items-center justify-center gap-2.5 rounded bg-[var(--color-earth)] px-4 py-2.5 font-medium text-white transition-colors hover:bg-[#4a3f33] ${className}`;

  if (status !== "authenticated") {
    return (
      <Link
        href={`/login?callbackUrl=${typeof window !== "undefined" ? window.location.pathname : "/storefront"}`}
        className={isFull ? fullClass : className}
        aria-label="Sign in to save to collection"
        onClick={(e) => e.stopPropagation()}
      >
        <IonIcon
          name="bookmark-outline"
          size={isFull ? 18 : iconSize}
          className={isFull ? "text-white shrink-0" : iconClassName}
        />
        {isFull ? <span>{label}</span> : null}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        className={isFull ? fullClass : className}
        aria-label={isFull ? label : "Save to collection"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <IonIcon
          name="bookmark-outline"
          size={isFull ? 18 : iconSize}
          className={isFull ? "text-white shrink-0" : iconClassName}
        />
        {isFull ? <span>{label}</span> : null}
      </button>
      <AddToCollectionModal
        open={open}
        onClose={() => setOpen(false)}
        storeItemId={storeItemId}
        storeItemTitle={storeItemTitle}
      />
    </>
  );
}
