import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Pressable,
  Image,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { getOrderStatusLabel } from "@/lib/order-status";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface OrderItem {
  id: string;
  quantity: number;
  priceCentsAtPurchase: number;
  storeItem: { id: string; title: string; slug: string; photos: string[] };
}

type OrderTab = "to_receive" | "delivered" | "canceled" | "all";

const ORDER_TABS: { key: OrderTab; label: string; param: string }[] = [
  { key: "to_receive", label: "To Receive", param: "buyer=1&to_receive=1" },
  { key: "delivered", label: "Delivered", param: "buyer=1&delivered=1" },
  { key: "canceled", label: "Canceled", param: "buyer=1&canceled=1" },
  { key: "all", label: "All", param: "buyer=1" },
];

interface StoreOrder {
  id: string;
  orderNumber?: string;
  totalCents: number;
  status: string;
  createdAt: string;
  isCashOrder?: boolean;
  seller: {
    firstName: string;
    lastName: string;
    businesses: { name: string; slug: string }[];
  };
  items: OrderItem[];
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function MyOrdersScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<OrderTab>("to_receive");
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    const param = ORDER_TABS.find((t) => t.key === tab)?.param ?? "buyer=1";
    apiGet<StoreOrder[] | { error: string }>(`/api/store-orders?${param}`)
      .then((data) => {
        if (Array.isArray(data)) {
          setOrders(data);
        } else {
          setError((data as { error?: string })?.error ?? "Failed to load orders.");
          setOrders([]);
        }
      })
      .catch(() => {
        setOrders([]);
        setError("Failed to load orders.");
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [tab]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  React.useEffect(() => {
    load();
  }, [tab]);

  if (loading && orders.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Orders</Text>
      <Text style={styles.hint}>Tap an order to view details, tracking, and status.</Text>

      <View style={styles.tabRow}>
        {ORDER_TABS.map((t) => (
          <Pressable
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {orders.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {tab === "to_receive"
              ? "No orders to receive."
              : tab === "delivered"
                ? "No delivered orders."
                : tab === "canceled"
                  ? "No canceled or refunded orders."
                  : "No orders yet."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} colors={[theme.colors.primary]} />
          }
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const sellerName =
              item.seller?.businesses?.[0]?.name ??
              (`${item.seller?.firstName ?? ""} ${item.seller?.lastName ?? ""}`.trim() || "Seller");
            const firstPhoto = item.items?.[0]?.storeItem?.photos?.[0];
            const photoUrl = resolvePhotoUrl(firstPhoto);

            return (
              <Pressable
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
                onPress={() => (router.push as (href: string) => void)(`/community/my-orders/${item.id}`)}
              >
                <View style={styles.cardRow}>
                  {photoUrl ? (
                    <Image source={{ uri: photoUrl }} style={styles.thumb} />
                  ) : (
                    <View style={styles.thumbPlaceholder}>
                      <Ionicons name="receipt" size={28} color="#999" />
                    </View>
                  )}
                  <View style={styles.cardBody}>
                    <Text style={styles.orderId}>#{item.orderNumber ?? item.id.slice(-8).toUpperCase()}</Text>
                    <Text style={styles.sellerName}>{sellerName}</Text>
                    <Text style={styles.date}>{formatDate(item.createdAt)}</Text>
                    <Text style={styles.total}>{formatPrice(item.totalCents)}</Text>
                    <View style={styles.statusBadge}>
                      <Text style={styles.statusText}>{getOrderStatusLabel(item.status)}</Text>
                    </View>
                    <View style={[styles.paymentTag, item.isCashOrder && styles.paymentTagCashBg]}>
                      <Text style={[styles.paymentTagText, item.isCashOrder && styles.paymentTagCash]}>
                        {item.isCashOrder ? "Awaiting Payment: Cash" : "Paid: Online NWC"}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={22} color="#999" />
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 4,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  hint: {
    fontSize: 13,
    color: "#666",
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    marginBottom: 12,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: theme.colors.primary },
  tabText: { fontSize: 13, color: "#666" },
  tabTextActive: { fontWeight: "600", color: theme.colors.primary },
  errorBanner: { backgroundColor: "#fee", padding: 12, marginHorizontal: 16, marginBottom: 16, borderRadius: 8 },
  errorText: { color: "#c62828", fontSize: 14 },
  empty: { padding: 32, alignItems: "center" },
  emptyText: { fontSize: 15, color: "#888" },
  list: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  cardRow: { flexDirection: "row", alignItems: "center", padding: 12 },
  thumb: { width: 56, height: 56, borderRadius: 8 },
  thumbPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: "#eee",
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1, marginLeft: 12 },
  orderId: { fontSize: 14, fontWeight: "600", color: "#333" },
  sellerName: { fontSize: 13, color: "#555", marginTop: 2 },
  date: { fontSize: 12, color: "#888", marginTop: 2 },
  total: { fontSize: 16, fontWeight: "600", color: theme.colors.primary, marginTop: 4 },
  statusBadge: { marginTop: 4, alignSelf: "flex-start" },
  statusText: { fontSize: 12, color: "#666", textTransform: "capitalize" },
  paymentTag: { marginTop: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: "rgba(0,0,0,0.06)" },
  paymentTagCashBg: { backgroundColor: "#fef3c7" },
  paymentTagText: { fontSize: 11, color: theme.colors.primary, fontWeight: "600" },
  paymentTagCash: { color: "#92400e" },
});
