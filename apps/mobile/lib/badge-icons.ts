import type { ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";

type IconName = ComponentProps<typeof Ionicons>["name"];

const SLUG_TO_ICON: Record<string, IconName> = {
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
  super_scanner: "scan-outline",
  elite_scanner: "qr-code-outline",
  badger_badge: "paw",
};

/** Returns an Ionicons name that fits the badge slug/name. Falls back to ribbon-outline. */
export function getBadgeIcon(slug: string): IconName {
  const key = slug?.toLowerCase?.().replace(/\s+/g, "_");
  return (key && SLUG_TO_ICON[key]) ?? "ribbon-outline";
}
