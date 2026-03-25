/**
 * Profile side menu - links to profile-related screens.
 */
import { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Dimensions,
  Share,
  ActivityIndicator,
  Alert,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, getToken } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useProfileView } from "@/contexts/ProfileViewContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 320);
const NAV_HEADER_HEIGHT = 44;

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
  hasSponsor?: boolean;
}

function NavLink({ item, onPress }: { item: NavItem; onPress: () => void }) {
  const showBadge = item.badgeExclamation || (item.badgeCount ?? 0) > 0;
  const badgeLabel = item.badgeExclamation ? "!" : (item.badgeCount! > 99 ? "99+" : String(item.badgeCount ?? 0));
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.navLink, pressed && styles.navLinkPressed]}
    >
      <View style={styles.navLinkLeft}>
        <View style={styles.navLinkIcon}>
          <Ionicons name={item.icon} size={22} color={theme.colors.primary} />
        </View>
        <Text style={styles.navLinkText}>{item.label}</Text>
      </View>
      <View style={styles.navLinkRight}>
        {showBadge && (
          <View style={[styles.inboxBadge, item.badgeExclamation && styles.exclamationBadge]}>
            <Text style={styles.inboxBadgeText}>{badgeLabel}</Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={18} color="#999" />
      </View>
    </Pressable>
  );
}

function Section({
  title,
  items,
  onNavigate,
}: {
  title: string;
  items: NavItem[];
  onNavigate: (href: string) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.divider} />
      {items.map((item) => (
        <NavLink key={item.href + item.label} item={item} onPress={() => onNavigate(item.href)} />
      ))}
    </View>
  );
}

const SUPPORT_EMAIL = "donivan@pnwcommunity.com";

const LEGAL_ITEMS: NavItem[] = [
  { href: `mailto:${SUPPORT_EMAIL}`, label: "Email support", icon: "mail-outline" },
  { href: `/web?url=${encodeURIComponent(siteBase + "/support-nwc")}&title=${encodeURIComponent("Support & Contact")}`, label: "Support & Contact", icon: "help-circle-outline" },
  { href: `/web?url=${encodeURIComponent(siteBase + "/terms")}&title=${encodeURIComponent("Terms of Service")}`, label: "Terms of Service", icon: "document-text-outline" },
  { href: `/web?url=${encodeURIComponent(siteBase + "/privacy")}&title=${encodeURIComponent("Privacy Policy")}`, label: "Privacy Policy", icon: "shield-checkmark-outline" },
];

export function ProfileSideMenu({ visible, onClose, hasSubscriber, hasSponsor }: ProfileSideMenuProps) {
  const router = useRouter();
  const { setProfileView } = useProfileView();
  const insets = useSafeAreaInsets();
  const drawerTop = insets.top + NAV_HEADER_HEIGHT;
  const showResaleHub = hasSubscriber;
  const { member, signOut } = useAuth();

  const hasManageablePaidPlan =
    member?.subscriptions?.some((s) =>
      ["active", "trialing", "past_due"].includes(s.status)
    ) ?? false;

  const [inviteLoading, setInviteLoading] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [incomingFriendRequests, setIncomingFriendRequests] = useState(0);

  const handleInviteFriends = async () => {
    setInviteLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        Alert.alert("Sign in required", "Please sign in to invite friends.");
        return;
      }
      const data = await apiGet<{ url: string }>("/api/me/referral-link");
      if (data?.url) {
        await Share.share({
          message: `Join me on Northwest Community! ${data.url}`,
          url: data.url,
          title: "Invite to Northwest Community",
        });
        onClose();
      }
    } catch {
      Alert.alert("Error", "Could not get invite link. Try again.");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    setBillingLoading(true);
    try {
      const res = await apiPost<{ url?: string; error?: string }>(
        "/api/stripe/billing-portal",
        { returnBaseUrl: siteBase }
      );
      if (res?.url) {
        onClose();
        const webUrl =
          `/web?url=${encodeURIComponent(res.url)}&title=Manage subscriptions` +
          `&successPattern=${encodeURIComponent("my-community/subscriptions")}` +
          `&successRoute=${encodeURIComponent("/(tabs)/my-community")}` +
          "&refreshOnSuccess=1";
        router.push(webUrl as any);
      } else {
        Alert.alert("Error", res?.error ?? "Could not open subscription management.");
      }
    } catch (e) {
      Alert.alert(
        "Error",
        (e as { error?: string })?.error ?? "Could not open subscription management."
      );
    } finally {
      setBillingLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      apiGet<{ unreadMessages?: number; incomingFriendRequests?: number }>("/api/me/sidebar-alerts")
        .then((d) => {
          setUnreadMessages(Number(d?.unreadMessages) || 0);
          setIncomingFriendRequests(Number(d?.incomingFriendRequests) || 0);
        })
        .catch(() => {});
    }
  }, [visible]);

  // My Friends + Friend Requests combined into one link to my-friends (that screen shows both).
  const communityItems: NavItem[] = [
    { href: "/messages", label: "Inbox", icon: "mail-unread-outline", badgeCount: unreadMessages || undefined },
    {
      href: "/community/my-friends",
      label: "My Friends",
      icon: "people-outline",
      ...(incomingFriendRequests > 0 ? { badgeCount: incomingFriendRequests } : {}),
    },
    { href: "/community/invites", label: "My Invites", icon: "calendar-outline" },
    { href: "/saved-posts", label: "My Saved Posts", icon: "bookmark-outline" },
    { href: "/community/groups", label: "My Groups", icon: "people-circle-outline" },
    { href: "invite:friends", label: "Share App", icon: "share-social-outline" },
  ];

  const supportLocalItems: NavItem[] = [
    { href: "/profile-businesses", label: "My Businesses", icon: "business-outline" },
    { href: "/my-sellers", label: "My Sellers", icon: "storefront-outline" },
    { href: "/profile-wishlist", label: "My Wishlist", icon: "heart-outline" },
    { href: "/rewards/my-rewards", label: "My Rewards", icon: "gift-outline" },
    { href: "/community/my-orders", label: "My Orders", icon: "receipt-outline" },
  ];

  const profileItems: NavItem[] = [
    ...(hasManageablePaidPlan
      ? [{ href: "action:manage-subscription", label: "Manage subscriptions", icon: "card-outline" as const }]
      : []),
    { href: "/profile-edit", label: "Delete account", icon: "trash-outline" },
    { href: "action:logout", label: "Logout", icon: "log-out-outline" },
  ];

  const handleNavigate = (href: string) => {
    if (href === "invite:friends") {
      handleInviteFriends();
      return;
    }
    if (href === "action:manage-subscription") {
      handleManageSubscription();
      return;
    }
    if (href === "action:logout") {
      onClose();
      signOut
        ?.()
        .then(() => router.replace("/(auth)/login" as any))
        .catch((e) => {
          if (__DEV__) console.warn("[ProfileSideMenu] signOut", e);
          router.replace("/(auth)/login" as any);
        });
      return;
    }
    if (href === "action:resale-hub") {
      onClose();
      setProfileView("resale_hub");
      router.push("/(tabs)/my-community" as any);
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.drawer, { top: drawerTop }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Profile</Text>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
              hitSlop={12}
            >
              <Ionicons name="close" size={28} color={theme.colors.heading} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Section title="Community" items={communityItems} onNavigate={handleNavigate} />
            <Section title="Support Local" items={supportLocalItems} onNavigate={handleNavigate} />
            <Section title="Profile" items={profileItems} onNavigate={handleNavigate} />
            {showResaleHub && (
              <Section
                title="Resale Hub"
                items={[{ href: "action:resale-hub", label: "Resale Hub", icon: "cash-outline" }]}
                onNavigate={handleNavigate}
              />
            )}
            <Section title="Legal" items={LEGAL_ITEMS} onNavigate={handleNavigate} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  drawer: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: "#fff",
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.primary,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.heading,
    letterSpacing: 1,
    marginBottom: 8,
  },
  divider: {
    height: 1,
    backgroundColor: "#e0e0e0",
    marginBottom: 12,
  },
  navLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  navLinkPressed: {
    opacity: 0.8,
    backgroundColor: "#f5f5f5",
  },
  navLinkLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
  },
  navLinkIcon: {
    marginRight: 12,
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  navLinkText: {
    fontSize: 15,
    color: "#444",
    flex: 1,
  },
  navLinkRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  inboxBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.primary,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 6,
  },
  exclamationBadge: {
    minWidth: 22,
    paddingHorizontal: 0,
  },
  inboxBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
  },
});
