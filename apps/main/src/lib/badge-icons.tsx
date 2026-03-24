import React from "react";

const IONICON_CDN = "https://unpkg.com/ionicons@7.1.0/dist/svg";

const SLUG_TO_IONICON: Record<string, string> = {
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
  admin_badge: "shield",
  local_business_pro: "card-outline",
  community_planner: "calendar-outline",
  party_planner: "sparkles-outline",
  super_scanner: "qr-code-outline",
  elite_scanner: "qr-code",
  badger_badge: "paw-outline",
  party_animal: "beer",
  coffee_lover: "cafe-outline",
  good_taste: "restaurant-outline",
  penny_pusher: "calculator-outline",
  car_trouble: "car-outline",
  handy_dandy: "hammer-outline",
  say_cheese: "camera",
  community_point_giver: "leaf-outline",
  local_deliverer: "bicycle-outline",
  here_in_town: "location-outline",
};

const DEFAULT_ICON = "ribbon-outline";

interface BadgeIconProps {
  slug: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Renders an Ionicons icon via CSS mask-image (CDN SVG).
 * Inherits color from `currentColor` (via background-color).
 */
export function BadgeIcon({ slug, size = 28, className, style }: BadgeIconProps) {
  const key = slug?.toLowerCase?.().replace(/\s+/g, "_");
  const iconName = (key && SLUG_TO_IONICON[key]) || DEFAULT_ICON;
  const url = `${IONICON_CDN}/${iconName}.svg`;

  return (
    <span
      role="img"
      aria-hidden
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        backgroundColor: "currentColor",
        WebkitMaskImage: `url(${url})`,
        maskImage: `url(${url})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        ...style,
      }}
    />
  );
}

/** Returns the Ionicons icon name for a badge slug. */
export function getBadgeIconName(slug: string): string {
  const key = slug?.toLowerCase?.().replace(/\s+/g, "_");
  return (key && SLUG_TO_IONICON[key]) || DEFAULT_ICON;
}

const CATEGORY_LABELS: Record<string, string> = {
  member: "Residents",
  business: "Businesses",
  seller: "Sellers",
  event: "Event",
  other: "Other",
};

export function getBadgeCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category?.toLowerCase?.()] ?? category ?? "Other";
}
