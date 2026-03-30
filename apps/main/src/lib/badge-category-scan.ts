import { BUSINESS_CATEGORY_LABELS } from "@/lib/business-categories";

/**
 * Primary category strings on Business.categories that qualify for
 * category_scan member badges. Every string MUST match a prebuilt primary
 * `label` from `BUSINESS_CATEGORIES` (business form / directory).
 * DB `Badge.criteria.categories` from seed should match this set.
 * @see packages/database/prisma/seed.js BADGES
 */
export const CATEGORY_SCAN_BADGE_PRIMARIES: Record<
  string,
  { categories: readonly string[]; scanCount: number; bonusPoints?: number }
> = {
  party_animal: { categories: ["Bar"], scanCount: 10, bonusPoints: 50 },
  coffee_lover: { categories: ["Coffee Shop"], scanCount: 20, bonusPoints: 50 },
  good_taste: { categories: ["Restaurant"], scanCount: 15, bonusPoints: 50 },
  car_trouble: { categories: ["Mechanic", "Automotive"], scanCount: 1, bonusPoints: 50 },
  handy_dandy: {
    categories: ["Handyman", "Plumber", "Electrician", "Drywaller", "HVAC", "Concrete"],
    scanCount: 1,
    bonusPoints: 80,
  },
  say_cheese: { categories: ["Photographer"], scanCount: 1, bonusPoints: 40 },
};

const PRESET_PRIMARY_SET = new Set(BUSINESS_CATEGORY_LABELS);

if (process.env.NODE_ENV === "development") {
  for (const [slug, spec] of Object.entries(CATEGORY_SCAN_BADGE_PRIMARIES)) {
    for (const c of spec.categories) {
      if (!PRESET_PRIMARY_SET.has(c)) {
        // eslint-disable-next-line no-console -- dev-only alignment guard
        console.warn(
          `[badge-category-scan] "${slug}" uses category "${c}" which is not in BUSINESS_CATEGORIES presets`
        );
      }
    }
  }
}
