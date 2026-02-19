import { prisma } from "database";
import { cloudinaryFetchUrl } from "@/lib/cloudinary";

const SITE_IMAGES_KEY = "site_images";

/**
 * Site image registry - paths used across the site that can be replaced via admin.
 * Keys must match the path (e.g. "directory-background" -> /directory-background.jpg)
 */
export const SITE_IMAGE_KEYS = [
  { key: "directory-background", path: "/directory-background.jpg", label: "Local Business Directory header" },
  { key: "support-local-logo", path: "/support-local-logo.png", label: "Support Local logo (directory)" },
  { key: "thanks-landscape", path: "/thanks-landscape.png", label: "Thanks page landscape" },
  { key: "nwc-logo-circle", path: "/nwc-logo-circle.png", label: "NWC logo circle (general)" },
  { key: "nwc-logo-coupon", path: "/nwc-logo-coupon.png", label: "NWC logo (coupon popup)" },
  { key: "nwc-logo-circle-crop", path: "/nwc-logo-circle-crop.png", label: "NWC logo crop (rewards)" },
  { key: "nwc-logo-circle-tan", path: "/nwc-logo-circle-tan.png", label: "NWC logo tan (coupons)" },
  { key: "nwc-logo-mobile-menu", path: "/nwc-logo-mobile-menu.png", label: "NWC logo mobile menu" },
  { key: "goals-1", path: "/goals-1.png", label: "About – Goal 1" },
  { key: "goals-2", path: "/goals-2.png", label: "About – Goal 2" },
  { key: "goals-3", path: "/goals-3.png", label: "About – Goal 3" },
  { key: "foundation-background", path: "/foundation-background.png", label: "About – Foundation background" },
  { key: "why-nwc-background", path: "/why-nwc-background.png", label: "Support NWC – Why NWC background" },
  { key: "rewards-header-bg", path: "/rewards-header-bg.png", label: "Rewards page header" },
  { key: "hero-background", path: "/hero-background.png", label: "Hero background (fallback)" },
  { key: "coupons-header-forest", path: "/coupons-header-forest.png", label: "Coupons header forest" },
  { key: "storefront-header", path: "/storefront-header.png", label: "Storefront header" },
  { key: "calendars-fun_events", path: "/calendars/fun_events.png", label: "Calendar – Fun Events" },
  { key: "calendars-local_art_music", path: "/calendars/local_art_music.png", label: "Calendar – Local Art & Music" },
  { key: "calendars-non_profit", path: "/calendars/non_profit.png", label: "Calendar – Non-Profit" },
  { key: "calendars-business_promotional", path: "/calendars/business_promotional.png", label: "Calendar – Business Promo" },
  { key: "calendars-marketing", path: "/calendars/marketing.png", label: "Calendar – Marketing" },
  { key: "calendars-real_estate", path: "/calendars/real_estate.png", label: "Calendar – Real Estate" },
] as const;

export type SiteImageKey = (typeof SITE_IMAGE_KEYS)[number]["key"];

const VERSION_KEY = "_v";

/**
 * Get the override URL for a site image, or null to use static path. Call from server components.
 * Admin-replaced images are routed through Cloudinary with AI upscale (e_upscale) for higher resolution.
 */
export async function getSiteImageUrl(key: SiteImageKey): Promise<string | null> {
  const row = await prisma.siteSetting.findUnique({ where: { key: SITE_IMAGES_KEY } });
  if (!row?.value || typeof row.value !== "object") return null;
  const v = row.value as Record<string, unknown>;
  const url = v[key];
  if (typeof url !== "string") return null;
  const version = typeof v[VERSION_KEY] === "number" ? v[VERSION_KEY] : 0;
  const versionedUrl = version ? `${url}?v=${version}` : url;
  return cloudinaryFetchUrl(versionedUrl, { upscale: true });
}
