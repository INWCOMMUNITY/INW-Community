/**
 * Resale Hub side menu - matches website ResaleHubSidebar structure.
 * Community Resale: List an Item, My Listings, Ship an Item, My Deliveries, My Pickups, New Offers, My Messages, Cancellations, My Payouts.
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
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 320);

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

const RESALE_HUB_ITEMS: NavItem[] = [
  { href: "/my-badges", label: "My Badges", web: false },
  { href: "/resale-hub/list", label: "List Items", web: false },
  { href: "/resale-hub/listings", label: "My Listings", web: true },
  { href: "/messages?tab=resale", label: "Resale Conversations", web: false },
  { href: "/resale-hub/payouts", label: "Payouts", web: true },
  { href: "/policies", label: "Policies", web: false },
  { href: "/resale-hub/ship", label: "Ship an Item", web: true },
  { href: "/resale-hub/deliveries", label: "My Deliveries", web: true },
  { href: "/resale-hub/pickups", label: "My Pickups", web: true },
  { href: "/resale-hub/offers", label: "New Offers", web: true },
  { href: "/resale-hub/cancellations", label: "Cancellations", web: true },
];

export function ResaleHubSideMenu({ visible, onClose }: ResaleHubSideMenuProps) {
  const router = useRouter();

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
        <View style={styles.drawer}>
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
              items={RESALE_HUB_ITEMS}
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
