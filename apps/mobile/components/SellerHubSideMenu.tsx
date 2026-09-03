/**
 * Seller Hub side menu — matches website SellerHubTopNav:
 * Listings, Orders, Store, Money. Expo-only screens (Sold Items, Drafts,
 * Returns, Analytics, etc.) stay in the matching group.
 */
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SideDrawer, SideDrawerSection, SideDrawerRow } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { useProfileView } from "@/contexts/ProfileViewContext";

const SOLD_ITEMS_VIEWED_KEY = "sellerHubSoldItemsViewedAt";

type NavItem = {
  href: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  alert?: boolean;
  action?: "stripe" | "business-hub";
};

interface SellerHubSideMenuProps {
  visible: boolean;
  onClose: () => void;
}

export function SellerHubSideMenu({ visible, onClose }: SellerHubSideMenuProps) {
  const router = useRouter();
  const { setProfileView } = useProfileView();
  const [pendingShip, setPendingShip] = useState(0);
  const [pendingReturns, setPendingReturns] = useState(0);
  const [soldCount, setSoldCount] = useState(0);
  const [soldItemsViewedAt, setSoldItemsViewedAt] = useState<string | null>(null);
  const [hasLocalDelivery, setHasLocalDelivery] = useState(false);
  const [needsAttentionCount, setNeedsAttentionCount] = useState(0);
  const [payoutReady, setPayoutReady] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const load = async () => {
      try {
        const [data, viewedAt] = await Promise.all([
          apiGet<{
            pendingShip?: number;
            pendingReturns?: number;
            soldCount?: number;
            hasLocalDelivery?: boolean;
            needsAttentionCount?: number;
            payoutReady?: boolean;
          }>("/api/seller-hub/pending-actions"),
          AsyncStorage.getItem(SOLD_ITEMS_VIEWED_KEY),
        ]);
        setPendingShip(Number(data.pendingShip) || 0);
        setPendingReturns(Number(data.pendingReturns) || 0);
        setSoldCount(Number(data.soldCount) || 0);
        setHasLocalDelivery(Boolean(data.hasLocalDelivery));
        setNeedsAttentionCount(Number(data.needsAttentionCount) || 0);
        setPayoutReady(Boolean(data.payoutReady));
        setSoldItemsViewedAt(viewedAt);
      } catch {
        // ignore
      }
    };
    load();
  }, [visible]);

  const soldItemsAlert = soldCount > 0 && !soldItemsViewedAt;

  const listingsItems: NavItem[] = [
    { href: "/seller-hub/store/items", label: "My Items", icon: "cube-outline" },
    { href: "/seller-hub/store/new", label: "List Item", icon: "add-circle-outline" },
    { href: "/seller-hub/store/items?tab=sold", label: "Sold Items", icon: "pricetag-outline", alert: soldItemsAlert },
    { href: "/seller-hub/store/drafts", label: "Drafts", icon: "document-text-outline" },
    {
      href: needsAttentionCount > 0 ? "/seller-hub/channels?tab=attention" : "/seller-hub/channels",
      label: "Sync Stores",
      icon: "sync-outline",
      alert: needsAttentionCount > 0,
    },
  ];

  const ordersItems: NavItem[] = [
    { href: "/seller-hub/orders", label: "Fulfillment", icon: "receipt-outline", alert: pendingShip > 0 },
    ...(hasLocalDelivery
      ? [{ href: "/seller-hub/orders?tab=deliveries", label: "Deliveries", icon: "bicycle-outline" as const }]
      : []),
    { href: "/seller-hub/offers", label: "Offers", icon: "pricetag-outline" },
    { href: "/seller-hub/store/returns", label: "Return Requests", icon: "arrow-undo-outline", alert: pendingReturns > 0 },
    { href: "/seller-hub/store/cancellations", label: "Cancellations", icon: "close-circle-outline" },
  ];

  const storeItems: NavItem[] = [
    { href: "/seller-hub/store", label: "Storefront Info", icon: "storefront-outline" },
    { href: "/policies", label: "Policies", icon: "book-outline" },
    { href: "/seller-hub/shipping-setup", label: "Shipping", icon: "boat-outline" },
    { href: "/seller-hub/shipping-options", label: "Shipping Options", icon: "cube-outline" },
    { href: "/seller-hub/time-away", label: "Time Away", icon: "calendar-outline" },
    { href: "/(tabs)/my-community", label: "Business Hub", icon: "business-outline", action: "business-hub" },
    { href: "/seller-hub/analytics", label: "Analytics", icon: "analytics-outline" },
    { href: "/seller-hub/activity", label: "Activity Log", icon: "time-outline" },
    { href: "/seller-hub/data-tools", label: "Data Tools", icon: "download-outline" },
  ];

  const moneyItems: NavItem[] = [
    { href: "/seller-hub/store/payouts", label: "Get Paid", icon: "wallet-outline", alert: payoutReady },
    { href: "#stripe", label: "Stripe Dashboard", icon: "card-outline", action: "stripe" },
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
    router.push(item.href as never);
  };

  const renderItems = (items: NavItem[]) =>
    items.map((item) => (
      <SideDrawerRow
        key={item.href + item.label}
        icon={item.icon}
        label={item.label}
        badgeExclamation={item.alert}
        onPress={() => handleItemPress(item)}
      />
    ));

  return (
    <SideDrawer visible={visible} onClose={onClose} title="Seller Hub">
      <SideDrawerSection title="Listings">{renderItems(listingsItems)}</SideDrawerSection>
      <SideDrawerSection title="Orders">{renderItems(ordersItems)}</SideDrawerSection>
      <SideDrawerSection title="Store">{renderItems(storeItems)}</SideDrawerSection>
      <SideDrawerSection title="Money">{renderItems(moneyItems)}</SideDrawerSection>
    </SideDrawer>
  );
}
