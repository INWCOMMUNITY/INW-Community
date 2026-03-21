/**
 * Primary category strings on Business.categories that qualify for
 * category_scan member badges (must match seed criteria exactly).
 * @see packages/database/prisma/seed.js BADGES
 */
export const CATEGORY_SCAN_BADGE_PRIMARIES: Record<
  string,
  { categories: readonly string[]; scanCount: number; bonusPoints?: number }
> = {
  party_animal: { categories: ["Bar"], scanCount: 10, bonusPoints: 50 },
  coffee_lover: { categories: ["Coffee Shop"], scanCount: 20, bonusPoints: 50 },
  good_taste: { categories: ["Restaurant"], scanCount: 15, bonusPoints: 50 },
  car_trouble: { categories: ["Mechanic"], scanCount: 1, bonusPoints: 50 },
  handy_dandy: {
    categories: ["Handyman", "Plumber", "Electrician", "Drywaller", "HVAC", "Concrete"],
    scanCount: 1,
    bonusPoints: 80,
  },
  say_cheese: { categories: ["Photographer"], scanCount: 1, bonusPoints: 40 },
};
