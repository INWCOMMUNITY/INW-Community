"use client";

/**
 * Rewards page header – hero layout with image and content card.
 * Green section background, tan borders, white content card.
 */

import Link from "next/link";
import { useState } from "react";

const REWARDS_HEADER_TITLE = "Northwest Community Rewards";
const REWARDS_HEADER_DESCRIPTION =
  "Check out the prizes that you can earn for supporting locally owned companies in Eastern Washington & North Idaho. Free gifts, services, and giveaways from locally owned businesses and NWC. Thank you for supporting local, be sure to save and redeem your Community Points. Subscribers earn 2x Points.";

const REWARDS_HEADER_IMAGE = "/rewards-header-bg.png";
const FALLBACK_HEADER_IMAGE = "/hero-background.png";
const REWARDS_LOGO = "/nwc-logo-circle-crop.png";

export function RewardsPageHeader() {
  const [imgSrc, setImgSrc] = useState(REWARDS_HEADER_IMAGE);

  return (
    <header
      className="w-full overflow-hidden border-2"
      style={{ backgroundColor: "var(--color-secondary)", borderColor: "var(--color-section-alt)" }}
      aria-label="Rewards page header"
    >
      <div
        className="w-full max-w-[var(--max-width)] mx-auto px-4 sm:px-6 lg:px-8 relative"
        style={{
          paddingTop: "clamp(1rem, 2vw, 2rem)",
          paddingBottom: "clamp(2rem, 3vw, 3rem)",
        }}
      >
        {/* Photo + white box + logo: wall-to-wall on mobile; desktop with fluid scaling */}
        <div
          className="relative w-full aspect-[21/10] rounded-xl overflow-hidden border-2 shadow-lg -mb-8 md:-mb-[2in] ml-0 md:-ml-[3in] max-md:mx-0 max-md:mb-6"
          style={{
            borderColor: "var(--color-section-alt)",
            minHeight: "clamp(280px, 38vw, 520px)",
            maxHeight: "min(720px, 55vh)",
          }}
        >
          <img
            src={imgSrc}
            alt="Northwest Community – outdoor scene"
            className="w-full h-full object-cover object-center"
            onError={() => setImgSrc(FALLBACK_HEADER_IMAGE)}
          />
        </div>

        {/* Content card – overlaps bottom of photo; fluid scaling on desktop */}
        <div
          className="relative w-full max-w-3xl max-md:w-[85%] max-md:max-w-[22rem] rounded-xl border-2 bg-white z-10 overflow-visible max-md:mt-[calc(-1.5rem+0.25in)] -mt-6 md:-mt-[1.8in] max-md:mx-auto mx-4 md:mx-0 md:ml-[6.95in] md:mr-auto"
          style={{
            borderColor: "var(--color-section-alt)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
            padding: "clamp(1rem, 2vw, 2.5rem)",
          }}
        >
          {/* Logo – only on large desktop; hidden on mobile and tablet; fluid size */}
          <img
            src={REWARDS_LOGO}
            alt="Northwest Community"
            className="absolute hidden lg:block rounded-full object-contain ring-2 ring-[var(--color-section-alt)] z-20 -translate-x-1/2 -translate-y-1/2 top-[-1.8in] left-[calc(50%-0.3in)]"
            style={{
              width: "clamp(12rem, 16vw, 258px)",
              height: "clamp(12rem, 16vw, 258px)",
            }}
          />
          <h1
            className="font-bold leading-tight mb-3 pt-6 max-md:pt-4 max-md:text-lg"
            style={{
              color: "var(--color-heading)",
              fontFamily: "var(--font-heading)",
              fontSize: "clamp(1.125rem, 2.2vw, 2.25rem)",
            }}
          >
            {REWARDS_HEADER_TITLE}
          </h1>
          <p
            className="leading-relaxed mb-4 max-md:mb-3 max-w-2xl max-md:text-xs"
            style={{
              color: "var(--color-text)",
              fontSize: "clamp(0.75rem, 1vw, 1rem)",
            }}
          >
            {REWARDS_HEADER_DESCRIPTION}
          </p>
          <Link
            href="/support-nwc"
            className="btn inline-block w-fit"
            style={{
              backgroundColor: "var(--color-button)",
              color: "var(--color-button-text)",
            }}
          >
            Subscribe
          </Link>
        </div>
      </div>
    </header>
  );
}
