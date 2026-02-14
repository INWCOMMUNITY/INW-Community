/**
 * Profile side menu - links to profile-related screens.
 */
import { useState } from "react";
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
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, getToken } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 320);

type NavItem = { href: string; label: string };

interface ProfileSideMenuProps {
  visible: boolean;
  onClose: () => void;
  hasSubscriber?: boolean;
  hasSponsor?: boolean;
}

function NavLink({ item, onPress }: { item: NavItem; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.navLink, pressed && styles.navLinkPressed]}
    >
      <Text style={styles.navLinkText}>{item.label}</Text>
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

const RESALE_HUB_ITEMS: NavItem[] = [
  { href: "/resale-hub/list", label: "List Items" },
  { href: `/web?url=${encodeURIComponent(siteBase + "/resale-hub/listings")}&title=${encodeURIComponent("My Listings")}`, label: "My Listings" },
  { href: "/messages?tab=resale", label: "Resale Conversations" },
  { href: `/web?url=${encodeURIComponent(siteBase + "/resale-hub/payouts")}&title=${encodeURIComponent("My Payouts")}`, label: "Payouts" },
  { href: "/policies", label: "Policies" },
];

export function ProfileSideMenu({ visible, onClose, hasSubscriber, hasSponsor }: ProfileSideMenuProps) {
  const router = useRouter();
  const showResaleHub = hasSubscriber || hasSponsor;

  const [inviteLoading, setInviteLoading] = useState(false);

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

  const items: NavItem[] = [
    { href: "/messages", label: "Inbox" },
    { href: "/my-badges", label: "My Badges" },
    { href: "invite:friends", label: "Invite Friends" },
    {
      href: `/web?url=${encodeURIComponent(`${siteBase}/my-community/friends`)}&title=${encodeURIComponent("My Friends")}`,
      label: "My Friends",
    },
    { href: "/profile-businesses", label: "My Businesses" },
    { href: "/profile-events", label: "My Events" },
    { href: "/profile-coupons", label: "My Coupons" },
    { href: "/profile-wishlist", label: "My Wishlist" },
    {
      href: `/web?url=${encodeURIComponent(`${siteBase}/my-community/orders`)}&title=${encodeURIComponent("My Orders")}`,
      label: "My Orders",
    },
    { href: "/profile-edit", label: "Edit Profile" },
  ];

  const handleNavigate = (href: string) => {
    if (href === "invite:friends") {
      handleInviteFriends();
      return;
    }
    onClose();
    router.push(href as any);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.drawer}>
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
            <Section title="Profile" items={items} onNavigate={handleNavigate} />
            {showResaleHub && (
              <Section title="Resale Hub" items={RESALE_HUB_ITEMS} onNavigate={handleNavigate} />
            )}
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
    width: DRAWER_WIDTH,
    maxHeight: "100%",
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
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  navLinkPressed: {
    opacity: 0.8,
    backgroundColor: "#f5f5f5",
  },
  navLinkText: {
    fontSize: 15,
    color: "#444",
  },
});
