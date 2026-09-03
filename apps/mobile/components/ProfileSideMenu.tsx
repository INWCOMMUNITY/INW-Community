/**
 * Profile side menu - links to profile-related screens.
 */
import { useState, useEffect } from "react";
import { Linking } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SideDrawer, SideDrawerSection, SideDrawerRow } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

type NavItem = {
  href: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  badgeCount?: number;
  badgeExclamation?: boolean;
};

interface ProfileSideMenuProps {
  visible: boolean;
  onClose: () => void;
  hasSubscriber?: boolean;
}

const SUPPORT_EMAIL = "donivan@pnwcommunity.com";

const LEGAL_ITEMS: NavItem[] = [
  { href: `mailto:${SUPPORT_EMAIL}`, label: "Email support", icon: "mail-outline" },
  { href: "/support-request", label: "Support & Contact", icon: "help-circle-outline" },
  { href: `/web?url=${encodeURIComponent(siteBase + "/terms")}&title=${encodeURIComponent("Terms of Service")}`, label: "Terms of Service", icon: "document-text-outline" },
  { href: `/web?url=${encodeURIComponent(siteBase + "/privacy")}&title=${encodeURIComponent("Privacy Policy")}`, label: "Privacy Policy", icon: "shield-checkmark-outline" },
];

export function ProfileSideMenu({ visible, onClose }: ProfileSideMenuProps) {
  const router = useRouter();
  const { member } = useAuth();

  const hasManageablePaidPlan =
    member?.subscriptions?.some((s) =>
      ["active", "trialing", "past_due"].includes(s.status)
    ) ?? false;

  const [unreadMessages, setUnreadMessages] = useState(0);
  const [incomingFriendRequests, setIncomingFriendRequests] = useState(0);
  const [commerceAttentionCount, setCommerceAttentionCount] = useState(0);

  const handleManageSubscription = () => {
    onClose();
    router.push("/manage-subscription" as never);
  };

  useEffect(() => {
    if (visible) {
      apiGet<{
        unreadMessages?: number;
        incomingFriendRequests?: number;
        commerceAttentionCount?: number;
      }>("/api/me/sidebar-alerts")
        .then((d) => {
          setUnreadMessages(Number(d?.unreadMessages) || 0);
          setIncomingFriendRequests(Number(d?.incomingFriendRequests) || 0);
          setCommerceAttentionCount(Number(d?.commerceAttentionCount) || 0);
        })
        .catch(() => {});
    }
  }, [visible]);

  const notificationsMenuBadge =
    unreadMessages + incomingFriendRequests + commerceAttentionCount > 0
      ? unreadMessages + incomingFriendRequests + commerceAttentionCount
      : undefined;

  const communityItems: NavItem[] = [
    {
      href: "/notifications",
      label: "Notifications",
      icon: "notifications-outline",
      ...(notificationsMenuBadge != null ? { badgeCount: notificationsMenuBadge } : {}),
    },
    { href: "/messages", label: "Inbox", icon: "mail-unread-outline", badgeCount: unreadMessages || undefined },
    {
      href: "/community/my-friends",
      label: "My Friends",
      icon: "people-outline",
      ...(incomingFriendRequests > 0 ? { badgeCount: incomingFriendRequests } : {}),
    },
    { href: "/community/invites", label: "My Invites", icon: "calendar-outline" },
    { href: "/saved-posts", label: "My Saved Posts", icon: "bookmark-outline" },
    { href: "/blocked-members", label: "Blocked Members", icon: "ban-outline" },
    { href: "/community/groups", label: "My Groups", icon: "people-circle-outline" },
    { href: "/share-inw-community", label: "Share App", icon: "share-social-outline" },
  ];

  const supportLocalItems: NavItem[] = [
    { href: "/profile-businesses", label: "My Businesses", icon: "business-outline" },
    { href: "/my-sellers", label: "My Sellers", icon: "storefront-outline" },
    { href: "/profile-wishlist", label: "My Wishlist", icon: "heart-outline" },
    { href: "/community/my-orders", label: "My Orders", icon: "receipt-outline" },
  ];

  const profileItems: NavItem[] = [
    ...(hasManageablePaidPlan
      ? [{ href: "action:manage-subscription", label: "Manage Subscriptions", icon: "card-outline" as const }]
      : []),
    {
      href: "/profile-notification-settings",
      label: "Notification Settings",
      icon: "notifications-outline",
    },
    { href: "/profile-edit", label: "Delete account", icon: "trash-outline" },
  ];

  const handleNavigate = (href: string) => {
    if (href === "action:manage-subscription") {
      handleManageSubscription();
      return;
    }
    if (href.startsWith("mailto:")) {
      onClose();
      Linking.openURL(href).catch(() => {});
      return;
    }
    onClose();
    router.push(href as any);
  };

  return (
    <SideDrawer visible={visible} onClose={onClose} title="Profile">
      <SideDrawerSection title="Community">
        {communityItems.map((item) => (
          <SideDrawerRow
            key={item.href + item.label}
            icon={item.icon}
            label={item.label}
            badgeCount={item.badgeCount}
            badgeExclamation={item.badgeExclamation}
            onPress={() => handleNavigate(item.href)}
          />
        ))}
      </SideDrawerSection>
      <SideDrawerSection title="Support Local">
        {supportLocalItems.map((item) => (
          <SideDrawerRow
            key={item.href + item.label}
            icon={item.icon}
            label={item.label}
            onPress={() => handleNavigate(item.href)}
          />
        ))}
      </SideDrawerSection>
      <SideDrawerSection title="Profile">
        {profileItems.map((item) => (
          <SideDrawerRow
            key={item.href + item.label}
            icon={item.icon}
            label={item.label}
            onPress={() => handleNavigate(item.href)}
          />
        ))}
      </SideDrawerSection>
      <SideDrawerSection title="Legal">
        {LEGAL_ITEMS.map((item) => (
          <SideDrawerRow
            key={item.href + item.label}
            icon={item.icon}
            label={item.label}
            onPress={() => handleNavigate(item.href)}
          />
        ))}
      </SideDrawerSection>
    </SideDrawer>
  );
}
