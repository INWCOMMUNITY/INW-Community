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
      <div className="w-full max-w-[var(--max-width)] mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 pb-10 sm:pb-12 relative">
        {/* Photo + white box + logo: wall-to-wall on mobile, same proportions; desktop with offset */}
        <div
          className="relative w-full aspect-[21/10] min-h-[360px] sm:min-h-[450px] max-h-[720px] rounded-xl overflow-hidden border-2 shadow-lg -mb-8 md:-mb-[2in] ml-0 md:-ml-[3in] max-md:mx-0"
          style={{
            borderColor: "var(--color-section-alt)",
          }}
        >
          <img
            src={imgSrc}
            alt="Northwest Community – outdoor scene"
            className="w-full h-full object-cover object-center"
            onError={() => setImgSrc(FALLBACK_HEADER_IMAGE)}
          />
        </div>

        {/* Content card – overlaps bottom of photo; on mobile smaller so it fits in photo area */}
        <div
          className="relative w-full max-w-3xl max-md:w-[85%] max-md:max-w-[22rem] rounded-xl border-2 p-4 max-md:p-4 sm:p-8 lg:p-10 bg-white z-10 overflow-visible max-md:mt-[calc(-1.5rem+0.25in)] -mt-6 md:-mt-[1.8in] max-md:mx-auto mx-4 md:mx-0 md:ml-[6.95in] md:mr-auto"
          style={{
            borderColor: "var(--color-section-alt)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
          }}
        >
          {/* Logo – only on large desktop; hidden on mobile and tablet */}
          <img
            src={REWARDS_LOGO}
            alt="Northwest Community"
            className="absolute hidden lg:block w-[258px] h-[258px] rounded-full object-contain ring-2 ring-[var(--color-section-alt)] z-20 -translate-x-1/2 -translate-y-1/2 top-[-1.8in] left-[calc(50%-0.3in)]"
          />
          <h1
            className="text-xl max-md:text-lg font-bold leading-tight sm:text-3xl lg:text-4xl mb-3 max-md:mb-2 pt-6 max-md:pt-4"
            style={{
              color: "var(--color-heading)",
              fontFamily: "var(--font-heading)",
            }}
          >
            {REWARDS_HEADER_TITLE}
          </h1>
          <p
            className="text-xs max-md:text-xs sm:text-base leading-relaxed mb-4 max-md:mb-3 max-w-2xl"
            style={{ color: "var(--color-text)" }}
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
