"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { CreateListingModal } from "./CreateListingModal";

interface ResalePageActionsProps {
  canList: boolean;
  isSeller: boolean;
}

export function ResalePageActions({ canList, isSeller }: ResalePageActionsProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const { status } = useSession();

  if (!canList) {
    return (
      <div className="mt-6 flex flex-wrap gap-3 justify-center">
        {status !== "authenticated" && (
          <Link
            href="/login?callbackUrl=/resale"
            className="inline-block px-6 py-3 rounded-lg font-medium bg-white/90 text-gray-900 hover:bg-white"
          >
            Sign in to sell
          </Link>
        )}
        <Link
          href="/support-nwc"
          className="inline-block px-6 py-3 rounded-lg font-medium border border-white/80 text-white hover:bg-white/10"
        >
          {status === "authenticated" ? "Subscribe to list items" : "Subscribe to list items"}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-wrap gap-3 justify-center items-center">
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="inline-block px-6 py-3 rounded-lg font-medium bg-white/90 text-gray-900 hover:bg-white"
      >
        List an item
      </button>
      {isSeller ? (
        <Link
          href="/seller-hub"
          className="inline-block px-6 py-3 rounded-lg font-medium border border-white/80 text-white hover:bg-white/10"
        >
          Manage your listings
        </Link>
      ) : (
        <Link
          href="/resale-hub"
          className="inline-block px-6 py-3 rounded-lg font-medium border border-white/80 text-white hover:bg-white/10"
        >
          Resale Hub
        </Link>
      )}
      <CreateListingModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
