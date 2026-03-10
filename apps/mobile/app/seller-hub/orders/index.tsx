import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { getOrderStatusLabel } from "@/lib/order-status";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

type OrderTab = "to_ship" | "shipped" | "canceled" | "all";

interface StoreOrder {
  id: string;
  status: string;
  totalCents: number;
  createdAt: string;
  orderNumber?: string;
  buyer?: { firstName: string; lastName: string };
  items?: { quantity: number; storeItem?: { title: string; slug: string; photos?: string[] } }[];
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(s: string): string {
  try {
    const d = new Date(s);
    return d.toLocaleDateString();
  } catch (_) {
    return s;
  }
}

const TABS: { key: OrderTab; label: string; param: string }[] = [
  { key: "to_ship", label: "To ship", param: "mine=1&needsShipment=1" },
  { key: "shipped", label: "Shipped", param: "mine=1&shipped=1" },
  { key: "canceled", label: "Canceled", param: "mine=1&canceled=1" },
  { key: "all", label: "All", param: "mine=1" },
];

export default function OrdersScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<OrderTab>("to_ship");
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    const param = TABS.find((t) => t.key === tab)?.param ?? "mine=1";
    setLoading(true);
    apiGet<StoreOrder[] | { error: string }>(`/api/store-orders?${param}`)
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .catch(() => setOrders([]))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [tab]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading && orders.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !loading && orders.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {tab === "to_ship"
                  ? "No orders to ship."
                  : tab === "shipped"
                    ? "No shipped orders."
                    : tab === "canceled"
                      ? "No canceled orders."
                      : "No orders yet."}
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const firstItem = item.items?.[0]?.storeItem;
          const photoUrl = firstItem?.photos?.[0] ? resolvePhotoUrl(firstItem.photos[0]) : undefined;
          const orderNum = item.orderNumber ?? item.id.slice(-8).toUpperCase();
          return (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
              onPress={() => router.push(`/seller-hub/orders/${item.id}` as never)}
            >
              <View style={styles.cardInner}>
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={styles.cardThumb} />
                ) : (
                  <View style={[styles.cardThumb, styles.cardThumbPlaceholder]} />
                )}
                <View style={styles.cardBody}>
                  <View style={styles.cardRow}>
                    <Text style={styles.orderId}>#{orderNum}</Text>
                    <Text style={styles.status}>{getOrderStatusLabel(item.status)}</Text>
                  </View>
                  <Text style={styles.buyer}>
                    {item.buyer ? `${item.buyer.firstName} ${item.buyer.lastName}` : "—"}
                  </Text>
                  <Text style={styles.date}>{formatDate(item.createdAt)}</Text>
                  <Text style={styles.total}>{formatPrice(item.totalCents)}</Text>
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#fff",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.primary,
  },
  tabText: { fontSize: 13, color: "#666" },
  tabTextActive: { fontWeight: "600", color: theme.colors.primary },
  list: { padding: 16, paddingBottom: 40 },
  empty: { padding: 32, alignItems: "center" },
  emptyText: { fontSize: 15, color: "#888" },
  card: {
    padding: 16,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    marginBottom: 12,
  },
  cardInner: { flexDirection: "row", alignItems: "flex-start" },
  cardThumb: { width: 56, height: 56, borderRadius: 8, marginRight: 12 },
  cardThumbPlaceholder: { backgroundColor: "#ddd" },
  cardBody: { flex: 1, minWidth: 0 },
  cardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderId: { fontSize: 14, fontWeight: "600", color: "#333" },
  status: { fontSize: 12, color: "#666", textTransform: "capitalize" },
  buyer: { fontSize: 14, color: "#444", marginTop: 4 },
  date: { fontSize: 12, color: "#888", marginTop: 2 },
  total: { fontSize: 16, fontWeight: "600", color: theme.colors.primary, marginTop: 4 },
});
