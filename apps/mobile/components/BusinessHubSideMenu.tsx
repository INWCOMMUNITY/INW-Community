/**
 * Business Hub side menu - matches the 4-button layout in my-community business hub.
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

type NavItem = { href: string; label: string };

interface BusinessHubSideMenuProps {
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
  onNavigate: (href: string) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.divider} />
      {items.map((item) => (
        <NavLink key={item.href} item={item} onPress={() => onNavigate(item.href)} />
      ))}
    </View>
  );
}

export function BusinessHubSideMenu({ visible, onClose }: BusinessHubSideMenuProps) {
  const router = useRouter();

  const items: NavItem[] = [
    { href: "/my-badges", label: "My Badges" },
    { href: "/sponsor-business", label: "Set up / Edit Local Business Page" },
    {
      href: `/web?url=${encodeURIComponent(`${siteBase}/sponsor-hub/coupon`)}&title=${encodeURIComponent("Offer a Coupon")}`,
      label: "Offer a Coupon",
    },
    {
      href: `/web?url=${encodeURIComponent(`${siteBase}/sponsor-hub/reward`)}&title=${encodeURIComponent("Offer a Reward")}`,
      label: "Offer a Reward",
    },
    {
      href: `/web?url=${encodeURIComponent(`${siteBase}/sponsor-hub/event`)}&title=${encodeURIComponent("Post Event")}`,
      label: "Post Event",
    },
    {
      href: `/web?url=${encodeURIComponent(`${siteBase}/sponsor-hub`)}&title=${encodeURIComponent("Sponsor Hub")}`,
      label: "Sponsor Hub",
    },
  ];

  const handleNavigate = (href: string) => {
    onClose();
    router.push(href as any);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.drawer}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Business Hub</Text>
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
          <Section title="Business Hub" items={items} onNavigate={handleNavigate} />
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
