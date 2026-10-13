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
};

/** Tan bookmark control that opens Add to collection. */
export function SaveToCollectionButton({
  storeItemId,
  storeItemTitle,
  className = "",
  iconSize = 16,
  iconClassName = "card-action-icon",
}: Props) {
  const { status } = useSession();
  const [open, setOpen] = useState(false);

  if (status !== "authenticated") {
    return (
      <Link
        href={`/login?callbackUrl=${typeof window !== "undefined" ? window.location.pathname : "/storefront"}`}
        className={className}
        aria-label="Sign in to save to collection"
        onClick={(e) => e.stopPropagation()}
      >
        <IonIcon name="bookmark-outline" size={iconSize} className={iconClassName} />
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        className={className}
        aria-label="Save to collection"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <IonIcon name="bookmark-outline" size={iconSize} className={iconClassName} />
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
