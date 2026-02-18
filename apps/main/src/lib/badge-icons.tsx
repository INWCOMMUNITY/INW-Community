import type { SVGProps } from "react";

/** Icon components – simple SVGs for web. Map badge slugs to icons. */
const SLUG_TO_ICON: Record<string, React.ComponentType<SVGProps<SVGSVGElement>>> = {};

function createIcon(path: string, viewBox = "0 0 24 24") {
  return function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <path d={path} />
      </svg>
    );
  };
}

// Heroicons-style paths (outline)
const icons = {
  person: createIcon("M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"),
  flower: createIcon("M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2C20 17.5 12 22 12 22z"),
  storefront: createIcon("M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"),
  business: createIcon("M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5m-4 0h4"),
  star: createIcon("M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"),
  cart: createIcon("M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-8 2a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"),
  medal: createIcon("M12 15l-3-3 2-4 4 2-3 3zM5 21h14l-2-4-2-2-2 2-2 4-4-4z"),
  megaphone: createIcon("M3 11l18-5v12L3 14v-3zM11 6v12"),
  newspaper: createIcon("M19 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1m2 13a2 2 0 0 1-2-2V7m2 13a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"),
  shield: createIcon("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"),
  card: createIcon("M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3z"),
  calendar: createIcon("M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z"),
  sparkles: createIcon("M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"),
  qrcode: createIcon("M3 3h5v5H3V3zm2 2v1h1V5H5zm-2 8h5v5H3v-5zm2 2v1h1v-1H5zm8-12h5v5h-5V3zm2 2v1h1V5h-1zm-2 8h5v5h-5v-5zm2 2v1h1v-1h-1zm4-4h2v2h-2v-2zm0 4h2v2h-2v-2zm-2-2h2v2h-2v-2z"),
  paw: createIcon("M18 10c0 1.657-1.343 3-3 3s-3-1.343-3-3 1.343-3 3-3 3 1.343 3 3zm-6 0c0 1.657-1.343 3-3 3S6 11.657 6 10s1.343-3 3-3 3 1.343 3 3zm-3 5c-2.21 0-4 1.79-4 4v1h8v-1c0-2.21-1.79-4-4-4z"),
  ribbon: createIcon("M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 0 0 1.946-.806 3.42 3.42 0 0 1 4.438 0 3.42 3.42 0 0 0 1.946.806 3.42 3.42 0 0 1 3.138 3.138 3.42 3.42 0 0 0 .806 1.946 3.42 3.42 0 0 1 0 4.438 3.42 3.42 0 0 0-.806 1.946 3.42 3.42 0 0 1-3.138 3.138 3.42 3.42 0 0 0-1.946.806 3.42 3.42 0 0 1-4.438 0 3.42 3.42 0 0 0-1.946-.806 3.42 3.42 0 0 1-3.138-3.138 3.42 3.42 0 0 0-.806-1.946 3.42 3.42 0 0 1 0-4.438 3.42 3.42 0 0 0 .806-1.946 3.42 3.42 0 0 1 3.138-3.138z"),
};

Object.assign(SLUG_TO_ICON, {
  community_member: icons.person,
  og_community_member: icons.flower,
  local_business: icons.storefront,
  og_nwc_business: icons.business,
  community_star_business: icons.star,
  nwc_seller: icons.cart,
  bronze_seller: icons.medal,
  silver_seller: icons.medal,
  gold_seller: icons.medal,
  platinum_seller: icons.medal,
  spreading_the_word: icons.megaphone,
  community_writer: icons.newspaper,
  admin_badge: icons.shield,
  local_business_pro: icons.card,
  community_planner: icons.calendar,
  party_planner: icons.sparkles,
  super_scanner: icons.qrcode,
  elite_scanner: icons.qrcode,
  badger_badge: icons.paw,
});

/** Returns a React icon component for the given badge slug. */
export function getBadgeIcon(slug: string): React.ComponentType<SVGProps<SVGSVGElement>> {
  const key = slug?.toLowerCase?.().replace(/\s+/g, "_");
  return (key ? SLUG_TO_ICON[key] : null) ?? icons.ribbon;
}

const CATEGORY_LABELS: Record<string, string> = {
  member: "Member",
  business: "Business",
  seller: "Seller",
  event: "Event",
  other: "Other",
};

/** Returns a display label for badge category. */
export function getBadgeCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category?.toLowerCase?.()] ?? category ?? "Other";
}
