/**
 * Seller Hub side menu - matches website SellerSidebar structure.
 * Three sections: Seller Profile, Storefront, Actions.
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
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 320);
const NAV_HEADER_HEIGHT = 56;

type NavItem = { href: string; label: string; alert?: boolean };

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
      <Text style={styles.navLinkText}>{item.label}</Text>
      {item.alert ? <AlertBadge /> : null}
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
        <NavLink
          key={item.href + item.label}
          item={item}
          onPress={() => onNavigate(item.href)}
        />
      ))}
    </View>
  );
}

export function SellerHubSideMenu({ visible, onClose }: SellerHubSideMenuProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const drawerTop = insets.top + NAV_HEADER_HEIGHT;
  const [showDeliveries, setShowDeliveries] = useState(false);
  const [pendingShip, setPendingShip] = useState(0);
  const [pendingReturns, setPendingReturns] = useState(0);
  const [payoutReady, setPayoutReady] = useState(false);

  useEffect(() => {
    if (!visible) return;
    apiGet<{ localDeliveryAvailable?: boolean }[] | { error?: string }>(
      "/api/store-items?mine=1"
    )
      .then((data) => {
        const items = Array.isArray(data) ? data : [];
        setShowDeliveries(items.some((i) => i.localDeliveryAvailable === true));
      })
      .catch(() => setShowDeliveries(false));

    apiGet<{
      pendingShip?: number;
      pendingReturns?: number;
      payoutReady?: boolean;
    }>("/api/seller-hub/pending-actions").then((data) => {
      setPendingShip(Number(data.pendingShip) || 0);
      setPendingReturns(Number(data.pendingReturns) || 0);
      setPayoutReady(Boolean(data.payoutReady));
    }).catch(() => {});
  }, [visible]);

  const storefrontItems: NavItem[] = [
    { href: "/seller-hub/store/items", label: "My Items" },
    { href: "/seller-hub/store/drafts", label: "Drafts" },
    { href: "/seller-hub/orders", label: "My Orders" },
    ...(showDeliveries ? [{ href: "/seller-hub/deliveries", label: "My Deliveries" }] : []),
    { href: "/seller-hub/store/payouts", label: "My Funds", alert: payoutReady },
  ];

  const actionItems: NavItem[] = [
    { href: "/seller-hub/store/new", label: "List Items" },
    { href: "/seller-hub/ship", label: "Ship Items", alert: pendingShip > 0 },
    { href: "/seller-hub/offers", label: "New Offers" },
    { href: "/seller-hub/store/returns", label: "Return Requests", alert: pendingReturns > 0 },
    { href: "/seller-hub/store/cancellations", label: "Cancellations" },
  ];

  const sellerProfileItems: NavItem[] = [
    { href: "/messages", label: "Inbox" },
    { href: "/my-badges", label: "My Badges" },
    { href: "/seller-hub/store", label: "Storefront Info" },
    { href: "/policies", label: "Policies" },
    { href: "/seller-hub/time-away", label: "Time Away" },
  ];

  const handleNavigate = (href: string) => {
    onClose();
    router.push(href as any);
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
            <Section title="Seller Profile" items={sellerProfileItems} onNavigate={handleNavigate} />
            <Section title="Storefront" items={storefrontItems} onNavigate={handleNavigate} />
            <Section title="Actions" items={actionItems} onNavigate={handleNavigate} />
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
  navLinkText: {
    fontSize: 15,
    color: "#444",
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
