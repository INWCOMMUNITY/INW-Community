/**
 * Resale Hub side menu - matches website ResaleHubSidebar structure.
 * Sections: Community Resale (List Item, My Listings, Sold Items, Offers, Messages, Cancellations, Policy);
 * Delivery (Ship Items, Local Deliveries, Local Pickups); Get Paid (Set Up / Payouts).
 */
import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 320);
const NAV_HEADER_HEIGHT = 44;

type NavItem = { href: string; label: string; web?: boolean };

interface ResaleHubSideMenuProps {
  visible: boolean;
  onClose: () => void;
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
  onNavigate: (item: NavItem) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.divider} />
      {items.map((item) => (
        <NavLink
          key={item.href + item.label}
          item={item}
          onPress={() => onNavigate(item)}
        />
      ))}
    </View>
  );
}

const COMMUNITY_RESALE_ITEMS: NavItem[] = [
  { href: "/seller-hub/store/new?listingType=resale", label: "List Item", web: false },
  { href: "/seller-hub/store/items?listingType=resale", label: "My Listings", web: false },
  { href: "/seller-hub/store/sold", label: "Sold Items", web: false },
  { href: "/seller-hub/offers", label: "Offers", web: false },
  { href: "/messages?tab=resale", label: "Messages", web: false },
  { href: "/seller-hub/store/cancellations", label: "Cancellations", web: false },
  { href: "/policies", label: "Policy", web: false },
];

const DELIVERY_ITEMS: NavItem[] = [
  { href: "/seller-hub/ship", label: "Ship Items", web: false },
  { href: "/seller-hub/deliveries", label: "Local Deliveries", web: false },
  { href: "/resale-hub/pickups", label: "Local Pickups", web: false },
];

export function ResaleHubSideMenu({ visible, onClose }: ResaleHubSideMenuProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const drawerTop = insets.top + NAV_HEADER_HEIGHT;
  const [payoutReady, setPayoutReady] = useState(false);

  useEffect(() => {
    if (!visible) return;
    apiGet<{ payoutReady?: boolean }>("/api/seller-hub/pending-actions")
      .then((data) => setPayoutReady(Boolean(data.payoutReady)))
      .catch(() => {});
  }, [visible]);

  const getPaidItems: NavItem[] = [
    {
      href: "/seller-hub/store/payouts",
      label: payoutReady ? "Payouts" : "Set Up",
      web: false,
    },
  ];

  const handleNavigate = (item: NavItem) => {
    onClose();
    if (item.web) {
      const url = `${siteBase}${item.href}`;
      router.push(
        `/web?url=${encodeURIComponent(url)}&title=${encodeURIComponent(item.label)}` as any
      );
    } else {
      router.push(item.href as any);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.drawer, { top: drawerTop }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Resale Hub</Text>
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
            <Section
              title="Community Resale"
              items={COMMUNITY_RESALE_ITEMS}
              onNavigate={handleNavigate}
            />
            <Section title="Delivery" items={DELIVERY_ITEMS} onNavigate={handleNavigate} />
            <Section title="Get Paid" items={getPaidItems} onNavigate={handleNavigate} />
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
