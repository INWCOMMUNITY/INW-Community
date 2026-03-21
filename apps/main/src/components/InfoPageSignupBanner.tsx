"use client";

import { useState } from "react";
import Link from "next/link";
import { WIX_IMG } from "@/lib/wix-media";
import { CheckoutButton } from "@/components/CheckoutButton";

interface InfoPageSignupBannerProps {
  /** Wix media path for wall-to-wall background (use with GALLERY_CTA_BACKGROUND). */
  backgroundPath: string;
  /** e.g. "Sign Up For Sponsor NWC" */
  heading: string;
  /** When set, the button goes directly to checkout for this plan (subscribe | sponsor | seller). */
  planId?: string;
  /** When planId is not set, link to this href. */
  buttonHref?: string;
  /** e.g. "Sign Up Now" */
  buttonLabel: string;
}

export function InfoPageSignupBanner({
  backgroundPath,
  heading,
  planId,
  buttonHref,
  buttonLabel,
}: InfoPageSignupBannerProps) {
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");

  return (
    <section
      className="relative w-full min-h-[320px] md:min-h-[400px] flex items-center justify-center overflow-hidden border-t-4"
      style={{ borderColor: "var(--color-primary)" }}
    >
      <img
        src={WIX_IMG(backgroundPath)}
        alt=""
        className="absolute inset-0 w-full h-full object-cover object-center"
        aria-hidden
      />
      <div className="relative z-10 mx-6 md:mx-12 py-12 md:py-16 px-10 md:px-16 rounded-lg text-center bg-white/80 shadow-lg max-w-xl">
        <h2
          className="text-xl md:text-3xl font-bold mb-6 whitespace-nowrap overflow-hidden text-ellipsis max-w-full"
          style={{ color: "var(--color-heading)", fontFamily: "var(--font-heading)" }}
        >
          {heading}
        </h2>
        {planId ? (
          <div className="flex flex-col items-center gap-4 w-full">
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={() => setInterval("monthly")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  interval === "monthly"
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setInterval("yearly")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  interval === "yearly"
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                Yearly
              </button>
            </div>
            <CheckoutButton planId={planId} interval={interval} className="btn">
              {buttonLabel}
            </CheckoutButton>
          </div>
        ) : (
          <Link href={buttonHref ?? "/support-nwc"} className="btn">
            {buttonLabel}
          </Link>
        )}
      </div>
    </section>
  );
}
