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

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface OrderItem {
  id: string;
  quantity: number;
  priceCentsAtPurchase: number;
  storeItem: { id: string; title: string; slug: string; photos: string[] };
}

interface StoreOrder {
  id: string;
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
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiGet<StoreOrder[] | { error: string }>("/api/store-orders?buyer=1")
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
  }, []);

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
      <Text style={styles.title}>My Orders</Text>
      <Text style={styles.hint}>Tap an order to view details, tracking, and status.</Text>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {orders.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No orders yet.</Text>
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
                    <Text style={styles.orderId}>#{item.id.slice(-8).toUpperCase()}</Text>
                    <Text style={styles.sellerName}>{sellerName}</Text>
                    <Text style={styles.date}>{formatDate(item.createdAt)}</Text>
                    <Text style={styles.total}>{formatPrice(item.totalCents)}</Text>
                    <View style={styles.statusBadge}>
                      <Text style={styles.statusText}>{item.status}</Text>
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
    marginBottom: 16,
    paddingHorizontal: 16,
  },
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
});
