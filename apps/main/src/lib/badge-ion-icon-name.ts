/**
 * IonIcon `name` for hub / member profile (Ionicons 7, kebab-case filenames on CDN).
 * Aligned with apps/mobile/lib/badge-icons.ts slug map.
 */
const SLUG_TO_ICON: Record<string, string> = {
  community_member: "person-outline",
  og_community_member: "flower-outline",
  local_business: "storefront-outline",
  og_nwc_business: "business-outline",
  community_star_business: "star-outline",
  nwc_seller: "cart-outline",
  bronze_seller: "medal-outline",
  silver_seller: "medal-outline",
  gold_seller: "medal-outline",
  platinum_seller: "medal-outline",
  spreading_the_word: "megaphone-outline",
  community_writer: "newspaper-outline",
  admin_badge: "shield-outline",
  local_business_pro: "card-outline",
  community_planner: "calendar-outline",
  party_planner: "sparkles-outline",
  super_scanner: "qr-code-outline",
  elite_scanner: "qr-code-outline",
  badger_badge: "paw-outline",
  party_animal: "beer-outline",
  coffee_lover: "cafe-outline",
  good_taste: "restaurant-outline",
  penny_pusher: "calculator-outline",
  car_trouble: "car-outline",
  handy_dandy: "hammer-outline",
  say_cheese: "camera-outline",
  community_point_giver: "leaf-outline",
  local_deliverer: "bicycle-outline",
  here_in_town: "location-outline",
};

export function badgeSlugToIonIconName(slug: string): string {
  const key = slug?.toLowerCase?.().replace(/\s+/g, "_") ?? "";
  return SLUG_TO_ICON[key] ?? "ribbon-outline";
}
