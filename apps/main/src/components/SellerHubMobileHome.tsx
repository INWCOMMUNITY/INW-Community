"use client";

import Link from "next/link";
import { SellerHubWorkQueue } from "@/components/SellerHubWorkQueue";

export function SellerHubMobileHome({ hasLocalDelivery }: { hasLocalDelivery: boolean }) {
  return (
    <div
      className="px-4 pt-3 pb-10"
      style={{ paddingBottom: "max(2.5rem, env(safe-area-inset-bottom))" }}
    >
      <div
        className="relative mb-5 w-full overflow-hidden rounded-2xl border-2 aspect-[16/9] min-h-[11.5rem]"
        style={{ borderColor: "var(--color-primary)" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/seller-hub-hero.jpg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-[center_61%]"
        />
        <div className="absolute inset-0 z-10 flex items-center justify-center p-5">
          <div className="w-full max-w-[17rem] rounded-xl bg-white/80 px-5 py-4 text-center shadow-md backdrop-blur-[2px]">
            <h1
              className="text-[1.35rem] font-bold mb-1.5 leading-tight"
              style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
            >
              Seller Hub
            </h1>
            <p className="text-[13px] leading-snug text-neutral-700">
              List items, sync marketplaces, fulfill orders, and get paid — all from one hub.
            </p>
          </div>
        </div>
      </div>

      <SellerHubWorkQueue hasLocalDelivery={hasLocalDelivery} variant="mobile" />

      <div className="mt-7 flex justify-center">
        <Link
          href="/business-hub?from=seller-hub"
          prefetch={false}
          className="inline-flex items-center rounded-full border-2 px-4 py-2 text-sm font-semibold transition active:bg-[var(--color-section-alt)]"
          style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
        >
          Go to Business Hub →
        </Link>
      </div>
    </div>
  );
}
