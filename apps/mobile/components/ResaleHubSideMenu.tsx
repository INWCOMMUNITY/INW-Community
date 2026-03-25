/**
 * Resale Hub side menu - full list (main hub shortcuts plus storefront, messages, time away, cancellations).
 */
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

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 320);
const NAV_HEADER_HEIGHT = 44;

type NavItem = {
  href: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  web?: boolean;
};

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
      <View style={styles.navLinkLeft}>
        <View style={styles.navLinkIcon}>
          <Ionicons name={item.icon} size={22} color={theme.colors.primary} />
        </View>
        <Text style={styles.navLinkText}>{item.label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#999" />
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

// Main hub flow first; full links including storefront, messages, time away, cancellations.
const RESALE_HUB_SIDE_MENU_ITEMS: NavItem[] = [
  { href: "/resale-hub/list", label: "List Item", icon: "add-circle-outline" },
  { href: "/seller-hub/store/items?listingType=resale", label: "My Listings", icon: "list-outline" },
  { href: "/seller-hub/orders", label: "Orders / To Ship", icon: "receipt-outline" },
  { href: "/seller-hub/deliveries", label: "Deliveries", icon: "car-outline" },
  { href: "/resale-hub/pickups", label: "Pick Ups", icon: "hand-left-outline" },
  { href: "/resale-hub/offers", label: "Offers", icon: "pricetag-outline" },
  { href: "/seller-hub/store/payouts", label: "Payouts", icon: "wallet-outline" },
  { href: "/resale-hub/before-you-start", label: "Before You Start", icon: "checkbox-outline" },
  { href: "/(tabs)/store?listingType=resale", label: "Resale Storefront", icon: "storefront-outline" },
  { href: "/messages?tab=resale", label: "Messages", icon: "chatbubbles-outline" },
  { href: "/seller-hub/time-away", label: "Time Away", icon: "calendar-outline" },
  { href: "/seller-hub/store/cancellations", label: "Cancellations", icon: "close-circle-outline" },
];

export function ResaleHubSideMenu({ visible, onClose }: ResaleHubSideMenuProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const drawerTop = insets.top + NAV_HEADER_HEIGHT;

  const handleNavigate = (item: NavItem) => {
    onClose();
    if (item.web) {
      const siteBase = (process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com").replace(/\/api.*$/, "").replace(/\/$/, "");
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
              title="NWC Resale"
              items={RESALE_HUB_SIDE_MENU_ITEMS}
              onNavigate={handleNavigate}
            />
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
});
