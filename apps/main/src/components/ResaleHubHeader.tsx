"use client";

import { usePathname } from "next/navigation";
import { cloudinaryFetchUrl } from "@/lib/cloudinary";
import { WIX_IMG } from "@/lib/wix-media";

const RESALE_HUB_HEADER_IMAGE =
  "2bdd49_f582d22b864044b096a7f124f1b6efda~mv2.jpg/v1/fill/w_1920,h_640,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Principle%203_edited.jpg";

export function ResaleHubHeader() {
  const pathname = usePathname();
  if (pathname !== "/resale-hub" && pathname !== "/resale-hub/") return null;

  return (
    <header
      className="relative w-full aspect-[3/1] min-h-[260px] max-h-[52vh] flex items-center justify-center overflow-hidden bg-gray-900"
      style={{
        backgroundImage: `url(${cloudinaryFetchUrl(WIX_IMG(RESALE_HUB_HEADER_IMAGE))})`,
        backgroundSize: "cover",
        backgroundPosition: "50% 65%",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="relative z-10 w-full max-w-2xl mx-auto px-3 max-md:px-2 py-4 max-md:py-3 md:px-6 md:py-10">
        <div className="bg-white/60 backdrop-blur-sm rounded-lg shadow-lg p-4 max-md:p-3 md:p-10 text-center max-md:max-h-[85%] max-md:overflow-auto max-md:max-w-[300px] max-md:mx-auto">
          <h1 className="text-[2.1rem] max-md:text-lg md:text-5xl font-bold mb-3 max-md:mb-2 text-black">
            Community Resale Hub
          </h1>
          <p className="text-black leading-relaxed max-md:text-xs max-md:leading-snug">
            List your pre-loved items, ship or deliver locally, respond to offers and messages, and manage your payouts—all in one place.
          </p>
        </div>
      </div>
    </header>
  );
}
