"use client";

import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";

export default function ManageStorePage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Manage Store</h1>
      <p className="text-gray-600 mb-6">View your listings, offers, and refund requests.</p>
      <ul className="space-y-3">
        <li>
          <Link
            href="/seller-hub/store/items"
            className="flex items-center gap-4 p-4 border-2 border-[var(--color-primary)] rounded-[10px] hover:bg-[var(--color-section-alt)] transition"
          >
            <IonIcon name="list" size={28} className="text-[var(--color-primary)] shrink-0" />
            <div className="flex-1 min-w-0 text-left">
              <span className="font-semibold block">Item Listings</span>
              <span className="text-sm text-gray-600">View and edit your storefront items</span>
            </div>
            <IonIcon name="chevron-forward" size={22} className="text-gray-400 shrink-0" />
          </Link>
        </li>
        <li>
          <Link
            href="/seller-hub/store/items"
            className="flex items-center gap-4 p-4 border-2 border-[var(--color-primary)] rounded-[10px] hover:bg-[var(--color-section-alt)] transition"
          >
            <IonIcon name="checkmark-done" size={28} className="text-[var(--color-primary)] shrink-0" />
            <div className="flex-1 min-w-0 text-left">
              <span className="font-semibold block">Sold Items</span>
              <span className="text-sm text-gray-600">Items you&apos;ve sold — moved here from My Items</span>
            </div>
            <IonIcon name="chevron-forward" size={22} className="text-gray-400 shrink-0" />
          </Link>
        </li>
        <li>
          <Link
            href="/seller-hub/offers"
            className="flex items-center gap-4 p-4 border-2 border-[var(--color-primary)] rounded-[10px] hover:bg-[var(--color-section-alt)] transition"
          >
            <IonIcon name="pricetag" size={28} className="text-[var(--color-primary)] shrink-0" />
            <div className="flex-1 min-w-0 text-left">
              <span className="font-semibold block">Offers Made</span>
              <span className="text-sm text-gray-600">Respond to offers on your items</span>
            </div>
            <IonIcon name="chevron-forward" size={22} className="text-gray-400 shrink-0" />
          </Link>
        </li>
        <li>
          <Link
            href="/seller-hub/store/returns"
            className="flex items-center gap-4 p-4 border-2 border-[var(--color-primary)] rounded-[10px] hover:bg-[var(--color-section-alt)] transition"
          >
            <IonIcon name="return-down-back" size={28} className="text-[var(--color-primary)] shrink-0" />
            <div className="flex-1 min-w-0 text-left">
              <span className="font-semibold block">Refund Requests</span>
              <span className="text-sm text-gray-600">Review and process return requests</span>
            </div>
            <IonIcon name="chevron-forward" size={22} className="text-gray-400 shrink-0" />
          </Link>
        </li>
      </ul>
    </div>
  );
}
