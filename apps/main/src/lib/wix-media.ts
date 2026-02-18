import type { CalendarType } from "types";

/**
 * Wix static media base URL. Paths are the part after static.wixstatic.com/media/
 */
export function WIX_IMG(path: string): string {
  return `https://static.wixstatic.com/media/${path}`;
}

export const WIX_HERO_BACKGROUND =
  "2bdd49_3e0b3310619741aebc191b1d45746584~mv2.jpeg/v1/fill/w_1920,h_1080,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/2bdd49_3e0b3310619741aebc191b1d45746584~mv2.jpeg";

export const WIX_HERO_GALLERY =
  "2bdd49_769b811f08604f59b947b70307ca3d4e~mv2.jpeg/v1/fill/w_1920,h_1080,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/Footer%20Pic.jpeg";

export const WIX_SUBSCRIBE_BACKGROUND =
  "2bdd49_67b47b0d8d3e4927848741a842e774a4~mv2.jpg/v1/fill/w_1920,h_1080,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/2bdd49_67b47b0d8d3e4927848741a842e774a4~mv2.jpg";

export const WIX_THANKS_IMAGE =
  "2bdd49_a2d0c41971f8455e840ff20b297ae917~mv2.jpg/v1/fill/w_800,h_600,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/2bdd49_a2d0c41971f8455e840ff20b297ae917~mv2.jpg";

export const WIX_FOUNDATION_BACKGROUND =
  "2bdd49_922cf38aad0542ef88e46e2aac2b0497~mv2.jpg/v1/fill/w_1200,h_400,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/2bdd49_922cf38aad0542ef88e46e2aac2b0497~mv2.jpg";

/** Gallery top photo (background.jpg) from https://www.pnwcommunity.com/gallery */
export const WIX_GALLERY_TOP_BACKGROUND =
  "2bdd49_26cd29bec17e4bb5b2990254f09f85d2~mv2.jpg/v1/fill/w_1810,h_432,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/background.jpg";

/** Calendar type to local image path (high-quality originals in public/calendars). Only use with valid CalendarType. */
const CALENDAR_PATHS: Record<CalendarType, string> = {
  fun_events: "/calendars/fun_events.png",
  local_art_music: "/calendars/local_art_music.png",
  non_profit: "/calendars/non_profit.png",
  business_promotional: "/calendars/business_promotional.png",
  marketing: "/calendars/marketing.png",
  real_estate: "/calendars/real_estate.png",
};

/** Get local image path for a calendar type. Returns undefined if type is invalid. */
export function getCalendarImagePath(type: string): string | undefined {
  return type in CALENDAR_PATHS ? CALENDAR_PATHS[type as CalendarType] : undefined;
}

/** All calendar types with paths, for iteration (e.g. calendars list). */
export const CALENDAR_IMAGES = CALENDAR_PATHS;

/** Slideshow images for Sponsor NWC info page (use with WIX_IMG). Higher res + q_90 for quality. */
export const SPONSOR_INFO_SLIDES = [
  "2bdd49_769b811f08604f59b947b70307ca3d4e~mv2.jpeg/v1/fill/w_1200,h_750,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/Footer%20Pic.jpeg",
  "2bdd49_9e1e39816a194b7d9e3557eb8a025cad~mv2.jpg/v1/fill/w_1200,h_750,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/Photo%20Nov%2007%202025%2C%209%2033%2002%20PM.jpg",
  "2bdd49_5e66f29694cd4b91a23e5a3e0ee2e0b7~mv2.jpg/v1/fill/w_1200,h_750,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/Principles%203.jpg",
  "2bdd49_46bd85d79e654db9bfc8b6d2a206d9a2~mv2.jpg/v1/fill/w_1200,h_750,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/0005_3A.jpg",
  "2bdd49_0061748f80f642939a6f4b70ddb4a27d~mv2.jpg/v1/fill/w_1200,h_750,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/Photo%20Nov%2007%202025%2C%208%2056%2020%20PM_edited_edited.jpg",
  "2bdd49_83882a11455141ffbbb316c8d27fde32~mv2.jpg/v1/fill/w_1200,h_750,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/0035_33_edited.jpg",
  "2bdd49_9e6b238548344f30bffd2795c2bfc194~mv2.jpg/v1/fill/w_1200,h_750,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/0036_34.jpg",
  "2bdd49_922cf38aad0542ef88e46e2aac2b0497~mv2.jpg/v1/fill/w_1200,h_750,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/2bdd49_922cf38aad0542ef88e46e2aac2b0497~mv2.jpg",
] as const;

/** Sponsor NWC page photo slots 1–5 (sponsor-specific gallery). High res + q_90. */
export const SPONSOR_INFO_BENEFIT_IMAGES = [
  "2bdd49_a0c29bafbe294be8a89f1210e2f0d06c~mv2.jpg/v1/fill/w_900,h_600,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/0024_22.jpg",
  "2bdd49_843ff2da3999401e83c20d6b5e6e52f4~mv2.jpg/v1/fill/w_900,h_600,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/0013_12A.jpg",
  "2bdd49_5e66f29694cd4b91a23e5a3e0ee2e0b7~mv2.jpg/v1/fill/w_900,h_600,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/2bdd49_5e66f29694cd4b91a23e5a3e0ee2e0b7~mv2.jpg",
  "2bdd49_ebdd31ab774b493a9c0db7a420d45870~mv2.jpg/v1/fill/w_900,h_600,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/2bdd49_ebdd31ab774b493a9c0db7a420d45870~mv2.jpg",
  "2bdd49_63b195e930614d278d146672fea212f4~mv2.jpg/v1/fill/w_900,h_600,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/Photo%20Nov%2007%202025%2C%207%2042%2000%20PM_edited.jpg",
] as const;

/** Seller NWC page photo slots 1–5 (seller-specific gallery). High res + q_90. */
export const SELLER_INFO_BENEFIT_IMAGES = [
  "2bdd49_46bd85d79e654db9bfc8b6d2a206d9a2~mv2.jpg/v1/fill/w_900,h_600,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/0005_3A.jpg",
  "2bdd49_83882a11455141ffbbb316c8d27fde32~mv2.jpg/v1/fill/w_900,h_600,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/0035_33_edited.jpg",
  "2bdd49_b30a1f64f6c9448eba48d97c2532d8b4~mv2.jpg/v1/fill/w_900,h_600,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/Form%20tattoo.jpg",
  "2bdd49_3fb13d9ddf394ef1808b4f226991e3dc~mv2.jpg/v1/fill/w_900,h_600,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/0019_18.jpg",
  "2bdd49_2d6af4dc1cf445c6b1befdcb25b3c7cd~mv2.jpg/v1/fill/w_900,h_600,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/Principle%203.jpg",
] as const;

/** "Not sure yet?" contact section: photo on the right (Donivan + dog from gallery). */
export const CONTACT_SECTION_PHOTO =
  "2bdd49_2c6059504c3042748d66896b5e730fc3~mv2.jpeg/v1/fill/w_600,h_800,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/2bdd49_2c6059504c3042748d66896b5e730fc3~mv2.jpeg";

/** Wall-to-wall CTA banner background from gallery (for “Sign up” section below Who Is This For?). */
export const GALLERY_CTA_BACKGROUND =
  "2bdd49_f7b2e60fb2534bd0af57006ffa313de5~mv2.jpg/v1/fill/w_1920,h_640,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/_edited.jpg";

/** Subscriber NWC page photo slots 1–5 (current gallery: GI, Collin, House, Car Mechanic, General Inquiries). High res + q_90. */
export const SUBSCRIBER_INFO_BENEFIT_IMAGES = [
  "2bdd49_a82c32098e3a4a9c8df4ef5365d2af14~mv2.jpg/v1/fill/w_900,h_600,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/GI.jpg",
  "2bdd49_bf48f4ae74e0447f8b157c3278b51796~mv2.jpg/v1/fill/w_900,h_600,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/Collin.jpg",
  "2bdd49_f4d898148e6a469ebde6fe11b438705f~mv2.jpg/v1/fill/w_900,h_600,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/House.jpg",
  "2bdd49_344bf3bd425f4742a53d88dab0acdef5~mv2.jpg/v1/fill/w_900,h_600,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/Car%20Mechanic.jpg",
  "2bdd49_a096b88b6d874370838d2684607fcbe1~mv2.jpg/v1/fill/w_900,h_600,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/General%20Inquiries.jpg",
] as const;
