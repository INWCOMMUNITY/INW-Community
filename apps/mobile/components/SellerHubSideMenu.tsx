/**
 * Seller Hub side menu - matches website SellerHubTopNav dropdown structure.
 * Categories: Seller Hub, Storefront, Actions, Profile. Excludes pages that are
 * on the main hub (List Items, Orders/To Ship, Storefront Info, Manage Store,
 * Deliveries, Pick Up, Payouts, Before You Start). Includes Ionicons.
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { useProfileView } from "@/contexts/ProfileViewContext";

const SOLD_ITEMS_VIEWED_KEY = "sellerHubSoldItemsViewedAt";
const SHIPPO_URL = "https://apps.goshippo.com/";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 320);
const NAV_HEADER_HEIGHT = 56;

type NavItem = {
  href: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  alert?: boolean;
  external?: boolean;
  action?: "stripe" | "create-post" | "business-hub" | "offer-coupon" | "offer-reward";
};

interface SellerHubSideMenuProps {
  visible: boolean;
  onClose: () => void;
}

function AlertBadge() {
  return (
    <View style={styles.alertBadge}>
      <Text style={styles.alertText}>!</Text>
    </View>
  );
}

function NavLink({
  item,
  onPress,
}: {
  item: NavItem;
  onPress: () => void;
}) {
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
        {item.alert ? <AlertBadge /> : null}
        <Ionicons name="chevron-forward" size={18} color="#999" />
      </View>
    </Pressable>
  );
}

function Section({
  title,
  items,
  onItemPress,
}: {
  title: string;
  items: NavItem[];
  onItemPress: (item: NavItem) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.divider} />
      {items.map((item) => (
        <NavLink
          key={item.href + item.label}
          item={item}
          onPress={() => onItemPress(item)}
        />
      ))}
    </View>
  );
}

export function SellerHubSideMenu({ visible, onClose }: SellerHubSideMenuProps) {
  const router = useRouter();
  const { setProfileView } = useProfileView();
  const insets = useSafeAreaInsets();
  const drawerTop = insets.top + NAV_HEADER_HEIGHT;
  const [pendingShip, setPendingShip] = useState(0);
  const [pendingReturns, setPendingReturns] = useState(0);
  const [soldCount, setSoldCount] = useState(0);
  const [soldItemsViewedAt, setSoldItemsViewedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const load = async () => {
      try {
        const [data, viewedAt] = await Promise.all([
          apiGet<{
            pendingShip?: number;
            pendingReturns?: number;
            soldCount?: number;
          }>("/api/seller-hub/pending-actions"),
          AsyncStorage.getItem(SOLD_ITEMS_VIEWED_KEY),
        ]);
        setPendingShip(Number(data.pendingShip) || 0);
        setPendingReturns(Number(data.pendingReturns) || 0);
        setSoldCount(Number(data.soldCount) || 0);
        setSoldItemsViewedAt(viewedAt);
      } catch {
        // ignore
      }
    };
    load();
  }, [visible]);

  const soldItemsAlert = soldCount > 0 && !soldItemsViewedAt;

  // Website dropdown: Storefront (exclude Orders, Pickups, Deliveries - on hub)
  const storefrontItems: NavItem[] = [
    { href: "/seller-hub/store/items", label: "My Items", icon: "cube-outline" },
    { href: "/seller-hub/store/sold", label: "Sold Items", icon: "pricetag-outline", alert: soldItemsAlert },
    { href: "/seller-hub/store/drafts", label: "Drafts", icon: "document-text-outline" },
    { href: "/seller-hub/offers", label: "Offers", icon: "pricetag-outline" },
    { href: "/seller-hub/store/cancellations", label: "Cancellations", icon: "close-circle-outline" },
    { href: "/policies", label: "Policies", icon: "book-outline" },
  ];

  // Website dropdown: Actions (exclude List Item - on hub). Offer Reward/Coupon go to actual Business Hub (my-community) and open the modal there.
  const actionItems: NavItem[] = [
    { href: "/seller-hub/ship", label: "Ship Item", icon: "boat-outline", alert: pendingShip > 0 },
    { href: "/(tabs)/my-community", label: "Offer Reward", icon: "gift-outline", action: "offer-reward" },
    { href: "/(tabs)/my-community", label: "Offer Coupon", icon: "pricetag-outline", action: "offer-coupon" },
    { href: "/(tabs)/my-community", label: "Create Post", icon: "megaphone-outline", action: "create-post" },
  ];

  // Website dropdown: Profile (exclude Seller Storefront - on hub as Storefront Info)
  const profileItems: NavItem[] = [
    { href: "/seller-hub/business-hub", label: "Local Business", icon: "business-outline" },
    { href: "/seller-hub/time-away", label: "Time Away", icon: "calendar-outline" },
    { href: "#stripe", label: "Stripe", icon: "card-outline", action: "stripe" },
    { href: SHIPPO_URL, label: "Shippo", icon: "boat-outline", external: true },
  ];

  // Website dropdown: Seller Hub (exclude Seller Hub home - current screen). Business Hub redirects to existing tab.
  const sellerHubItems: NavItem[] = [
    { href: "/(tabs)/my-community", label: "Business Hub", icon: "business-outline", action: "business-hub" },
  ];

  const handleItemPress = async (item: NavItem) => {
    onClose();
    if (item.action === "stripe") {
      try {
        const data = await apiGet<{ url?: string }>("/api/stripe/connect/express-dashboard");
        if (data?.url) {
          router.push(
            `/web?url=${encodeURIComponent(data.url)}&title=${encodeURIComponent("Stripe")}` as never
          );
        } else {
          router.push("/seller-hub/store/payouts" as never);
        }
      } catch {
        router.push("/seller-hub/store/payouts" as never);
      }
      return;
    }
    if (item.action === "business-hub") {
      setProfileView("business_hub");
      router.push("/(tabs)/my-community" as never);
      return;
    }
    if (item.action === "offer-reward") {
      setProfileView("business_hub");
      router.push("/(tabs)/my-community?open=reward" as never);
      return;
    }
    if (item.action === "offer-coupon") {
      setProfileView("business_hub");
      router.push("/(tabs)/my-community?open=coupon" as never);
      return;
    }
    if (item.action === "create-post") {
      router.push("/(tabs)/my-community" as never);
      return;
    }
    if (item.external && item.href.startsWith("http")) {
      const siteBase = (process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com").replace(/\/api.*$/, "").replace(/\/$/, "");
      router.push(
        `/web?url=${encodeURIComponent(item.href)}&title=${encodeURIComponent(item.label)}` as never
      );
      return;
    }
    router.push(item.href as never);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.drawer, { top: drawerTop }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Seller Hub</Text>
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
            <Section title="Seller Hub" items={sellerHubItems} onItemPress={handleItemPress} />
            <Section title="Storefront" items={storefrontItems} onItemPress={handleItemPress} />
            <Section title="Actions" items={actionItems} onItemPress={handleItemPress} />
            <Section title="Profile" items={profileItems} onItemPress={handleItemPress} />
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
    top: 0,
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
  alertBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  alertText: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#fff",
  },
});
