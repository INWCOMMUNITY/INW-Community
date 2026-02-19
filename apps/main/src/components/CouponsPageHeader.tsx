"use client";

import Link from "next/link";

const SECTION_BG = "#f8e7c9";
const BOX_BG = "#FFFFFF";
const NWC_LOGO = "/nwc-logo-circle-tan.png";

const TITLE = "Northwest Community – Coupons and Promotions";
const DESCRIPTION =
  "Local Businesses are offering you discounts for shopping local with them. Subscribe to Northwest Community and receive a monthly coupon book full of savings, and more benefits for this community supporting local goods, food, shops, and services! Check it out!";

/** Coupon header – forest path scene */
const COUPONS_HEADER_IMAGE = "/coupons-header-forest.png";

const PHOTO_SHIFT_LEFT = "3in";
const BOX_SHIFT_RIGHT = "6.05in";
const GREEN_PADDING_SIDES = "3in";
const TAN_GAP = "0.35in"; /* tan above photo and visible tan below white box */
const GREEN_ABOVE_PHOTO = TAN_GAP;
const WHITE_BOX_OVERHANG = "0.7in"; /* white box extends this far below photo */
const TAN_BELOW = "1.05in"; /* TAN_GAP + WHITE_BOX_OVERHANG so visible tan below = TAN_GAP */
const BLOCK_CENTER_OFFSET = "0"; /* was 4.5% – set to 0 to center photo+white box wall-to-wall */

export function CouponsPageHeader() {
  return (
    <header
      className="w-full min-h-[620px] md:min-h-[620px] flex flex-col justify-end overflow-visible border-2 border-[var(--color-secondary)] pb-0 pl-4 pr-4 md:pl-[3in] md:pr-[3in]"
      style={{
        backgroundColor: SECTION_BG,
        paddingTop: GREEN_ABOVE_PHOTO,
        paddingBottom: 0,
      }}
      aria-label="Coupons and promotions"
    >
      {/* Mobile: wall-to-wall photo + white box + logo, same proportions */}
      <div className="md:hidden w-full px-0 flex flex-col items-center overflow-visible" style={{ paddingBottom: TAN_BELOW }}>
        <div className="relative w-full aspect-[21/10] min-h-[260px] rounded-lg overflow-visible border-2 border-[var(--color-secondary)] -translate-y-[1.5in]">
          <div className="absolute inset-0 rounded-t-lg overflow-hidden bg-gray-800">
            <img
              src={COUPONS_HEADER_IMAGE}
              alt="Northwest Community – forest path"
              className="w-full h-full object-cover object-center"
              style={{ objectPosition: "center -0.3in" }}
            />
          </div>
          <img
            src={NWC_LOGO}
            alt="Northwest Community"
            className="absolute left-1/2 w-20 h-20 rounded-full object-contain -translate-x-1/2 -translate-y-1/2 z-10"
            style={{ bottom: "calc(25% + 1.8in)" }}
          />
          <div
            className="absolute left-1/2 -translate-x-1/2 w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] rounded-lg flex flex-col justify-center px-4 py-4 border-2 border-[var(--color-secondary)] border-t-0 -mb-4 min-w-0 overflow-hidden"
            style={{
              backgroundColor: BOX_BG,
              boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
              top: "calc(100% - 0.35in)",
              containerType: "inline-size",
            }}
          >
            <h1
              className="font-bold leading-tight mb-2 break-words"
              style={{
                color: "var(--color-heading)",
                fontFamily: "var(--font-heading)",
                fontSize: "clamp(0.75rem, 8cqi, 1.25rem)",
              }}
            >
              {TITLE}
            </h1>
            <p
              className="leading-relaxed mb-3 break-words min-w-0"
              style={{
                color: "var(--color-text)",
                fontSize: "clamp(0.6875rem, 3.5cqi, 0.875rem)",
              }}
            >
              {DESCRIPTION}
            </p>
            <Link href="/support-nwc" className="btn inline-block w-fit text-sm py-1.5 px-3 shrink-0" style={{ backgroundColor: "var(--color-button)", color: "var(--color-button-text)" }}>
              Subscribe
            </Link>
          </div>
        </div>
      </div>

      {/* Desktop: fluid scaling with clamp until mobile breakpoint */}
      <div
        className="hidden md:block w-full max-w-[var(--max-width)] mx-auto flex justify-center overflow-visible"
        style={{ paddingBottom: TAN_BELOW }}
      >
        <div
          className="relative w-full min-h-[500px] flex-shrink-0"
          style={{
            transform: `translateX(${BLOCK_CENTER_OFFSET})`,
            marginTop: "clamp(0.2rem, 1.5vw, 0.3in)",
          }}
        >
          <div
            className="absolute left-1/2 bottom-0 w-[95%] min-w-[442px] max-w-[960px] aspect-[21/10] rounded-lg overflow-visible border-2 border-[var(--color-secondary)]"
            style={{
              transform: `translateX(calc(-50% - ${PHOTO_SHIFT_LEFT})) translateY(0)`,
              minHeight: "clamp(420px, 45vw, 520px)",
            }}
          >
            <div className="absolute inset-0 rounded-[calc(0.5rem-2px)] overflow-hidden bg-gray-800">
              <img
                src={COUPONS_HEADER_IMAGE}
                alt="Northwest Community – forest path"
                className="w-full h-full object-cover object-center"
              />
            </div>
            <img
              src={NWC_LOGO}
              alt="Northwest Community"
              className="absolute rounded-full object-contain -translate-x-1/2 translate-y-1/2 z-10"
              style={{
                left: `calc(62.5% + ${BOX_SHIFT_RIGHT} - 0.62in)`,
                bottom: "calc(90% - 0.7in)",
                width: "clamp(8rem, 18vw, 18rem)",
                height: "clamp(8rem, 18vw, 18rem)",
              }}
            />
            <div
              className="absolute rounded-lg flex flex-col justify-center border-2 border-[var(--color-secondary)] min-w-0 overflow-hidden -translate-x-1/2"
              style={{
                backgroundColor: BOX_BG,
                boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
                left: `calc(62.5% + ${BOX_SHIFT_RIGHT} - 0.62in)`,
                bottom: "calc(-0.7in - 1.9in + 2in)",
                width: "75%",
                minWidth: "320px",
                aspectRatio: "21/9",
                minHeight: "clamp(200px, 22vw, 260px)",
                padding: "clamp(1rem, 2.5vw, 2.5rem)",
                containerType: "inline-size",
              }}
            >
              <h1
                className="font-bold leading-tight mb-3 break-words min-w-0"
                style={{
                  color: "var(--color-heading)",
                  fontFamily: "var(--font-heading)",
                  fontSize: "clamp(0.75rem, 6cqi, 2.25rem)",
                }}
              >
                {TITLE}
              </h1>
              <p
                className="leading-relaxed mb-6 max-w-2xl break-words min-w-0"
                style={{
                  color: "var(--color-text)",
                  fontSize: "clamp(0.6875rem, 2.5cqi, 1rem)",
                }}
              >
                {DESCRIPTION}
              </p>
              <Link href="/support-nwc" className="btn inline-block w-fit shrink-0" style={{ backgroundColor: "var(--color-button)", color: "var(--color-button-text)" }}>
                Subscribe
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
