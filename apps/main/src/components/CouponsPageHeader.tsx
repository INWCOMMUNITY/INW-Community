"use client";

import Link from "next/link";

const SECTION_BG = "#f8e7c9";
const BOX_BG = "#FFFFFF";
const NWC_LOGO = "/nwc-logo-circle-crop.png";
const COUPONS_HEADER_IMAGE = "/coupons-header-forest.png";

const TITLE = "Northwest Community – Coupons and Promotions";
const DESCRIPTION =
  "Local Businesses are offering you discounts for shopping local with them. Subscribe to Northwest Community and receive a monthly coupon book full of savings, and more benefits for this community supporting local goods, food, shops, and services! Check it out!";

export function CouponsPageHeader() {
  return (
    <header
      className="w-full overflow-hidden border-2"
      style={{ backgroundColor: SECTION_BG, borderColor: "var(--color-secondary)" }}
      aria-label="Coupons and promotions"
    >
      <div className="mx-auto w-full max-w-[var(--max-width)] px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        <div className="relative">
          <div
            className="relative w-full overflow-hidden rounded-xl border-2 shadow-lg aspect-[5/3] sm:aspect-[2/1] lg:aspect-[21/9]"
            style={{ borderColor: "var(--color-secondary)" }}
          >
            <img
              src={COUPONS_HEADER_IMAGE}
              alt="Northwest Community – forest path"
              className="h-full w-full object-cover object-center"
            />
          </div>

          <div
            className="relative z-10 mx-auto -mt-8 w-[92%] max-w-4xl rounded-xl border-2 px-5 pb-5 pt-14 sm:-mt-10 sm:px-8 sm:pb-6 sm:pt-16 md:-mt-12 md:px-10"
            style={{
              backgroundColor: BOX_BG,
              borderColor: "var(--color-secondary)",
              boxShadow: "0 4px 24px rgba(0, 0, 0, 0.08)",
            }}
          >
            <div
              className="absolute left-1/2 top-0 h-20 w-20 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border-2 sm:h-24 sm:w-24 md:h-28 md:w-28"
              style={{ borderColor: "var(--color-secondary)" }}
            >
              <img src={NWC_LOGO} alt="Northwest Community" className="h-full w-full scale-105 object-cover" />
            </div>
            <h1
              className="font-bold leading-tight mb-3 break-words"
              style={{
                color: "var(--color-heading)",
                fontFamily: "var(--font-heading)",
                fontSize: "clamp(1.125rem, 2.2vw, 1.85rem)",
              }}
            >
              {TITLE}
            </h1>
            <p
              className="leading-relaxed mb-4 break-words"
              style={{
                color: "var(--color-text)",
                fontSize: "clamp(0.8125rem, 1.1vw, 1rem)",
              }}
            >
              {DESCRIPTION}
            </p>
            <div className="flex justify-center">
              <Link
                href="/support-nwc"
                className="btn inline-block w-fit shrink-0"
                style={{ backgroundColor: "var(--color-button)", color: "var(--color-button-text)" }}
              >
                Subscribe
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
