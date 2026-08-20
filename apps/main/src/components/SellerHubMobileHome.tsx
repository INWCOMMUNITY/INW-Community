"use client";

import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";
import { SellerHubWorkQueue } from "@/components/SellerHubWorkQueue";

export function SellerHubMobileHome({ hasLocalDelivery }: { hasLocalDelivery: boolean }) {
  return (
    <div className="px-4 pt-4 pb-10" style={{ paddingBottom: "max(2.5rem, env(safe-area-inset-bottom))" }}>
      <div
        className="flex flex-row items-center gap-4 mb-6 py-4 px-4 rounded-xl border-2"
        style={{
          backgroundColor: "var(--color-section-alt)",
          borderColor: "var(--color-primary)",
        }}
      >
        <div className="flex-1 min-w-0">
          <h1
            className="text-xl font-bold mb-1.5"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            Seller Hub
          </h1>
          <p className="text-sm leading-5" style={{ color: "var(--color-text)" }}>
            Manage your storefront, ship orders, get paid.
          </p>
        </div>
        <div
          className="w-[72px] h-[72px] rounded-full shrink-0 flex items-center justify-center bg-white border-2"
          style={{ borderColor: "var(--color-primary)" }}
        >
          <IonIcon name="briefcase" size={40} className="text-[var(--color-primary)]" />
        </div>
      </div>

      <SellerHubWorkQueue hasLocalDelivery={hasLocalDelivery} variant="mobile" />

      <div className="mt-6 flex justify-center">
        <Link
          href="/business-hub?from=seller-hub"
          prefetch={false}
          className="py-2 px-4 text-sm font-semibold"
          style={{ color: "var(--color-primary)" }}
        >
          Go to Business Hub →
        </Link>
      </div>
    </div>
  );
}
