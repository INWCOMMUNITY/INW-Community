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
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface OrderItemType {
  id: string;
  quantity: number;
  fulfillmentType?: string | null;
  storeItem: { id: string; title: string; slug: string; photos: string[] };
}

interface StoreOrder {
  id: string;
  status: string;
  totalCents: number;
  createdAt: string;
  buyer?: { firstName: string; lastName: string };
  items?: OrderItemType[];
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString();
  } catch {
    return s;
  }
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function SellerHubPickupsScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    apiGet<StoreOrder[] | { error: string }>("/api/store-orders?mine=1")
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        // Only orders that have at least one item with pickup fulfillment
        const pickupOnly = list.filter((o) =>
          o.items?.some((i) => (i.fulfillmentType ?? "").toLowerCase() === "pickup")
        );
        setOrders(pickupOnly);
      })
      .catch(() => setOrders([]))
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
      <Text style={styles.intro}>
        Orders with in-store or local pickup will appear here. Mark them as picked up when the buyer collects the item.
      </Text>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No pickup orders right now.</Text>}
        renderItem={({ item }) => {
          const items = item.items ?? [];
          return (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
              onPress={() => router.push(`/seller-hub/orders/${item.id}` as never)}
            >
              <View style={styles.cardRow}>
                <Text style={styles.orderId}>#{item.id.slice(0, 8)}</Text>
                <Text style={styles.status}>{item.status}</Text>
              </View>
              <Text style={styles.buyer}>
                {item.buyer ? `${item.buyer.firstName} ${item.buyer.lastName}` : "—"}
              </Text>
              <Text style={styles.date}>{formatDate(item.createdAt)}</Text>
              <Text style={styles.total}>{formatPrice(item.totalCents)}</Text>
              {items.length > 0 && (
                <View style={styles.itemsRow}>
                  {items.map((oi) => {
                    const photoUrl = resolvePhotoUrl(oi.storeItem?.photos?.[0]);
                    return (
                      <View key={oi.id} style={styles.itemChip}>
                        {photoUrl ? (
                          <Image source={{ uri: photoUrl }} style={styles.itemThumb} />
                        ) : (
                          <View style={[styles.itemThumb, styles.itemThumbPlaceholder]} />
                        )}
                        <Text style={styles.itemTitle} numberOfLines={1}>
                          {oi.storeItem?.title ?? "Item"} × {oi.quantity}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
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
  intro: { padding: 16, paddingBottom: 8, fontSize: 14, color: theme.colors.text },
  list: { padding: 16, paddingBottom: 40 },
  empty: { padding: 24, textAlign: "center", color: theme.colors.placeholder },
  card: { padding: 16, backgroundColor: "#f9f9f9", borderRadius: 8, marginBottom: 12 },
  cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderId: { fontSize: 14, fontWeight: "600", color: "#333" },
  status: { fontSize: 12, color: "#666", textTransform: "capitalize" },
  buyer: { fontSize: 14, color: "#444", marginTop: 8 },
  date: { fontSize: 12, color: "#888", marginTop: 4 },
  total: { fontSize: 16, fontWeight: "600", color: theme.colors.primary, marginTop: 8 },
  itemsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  itemChip: { flexDirection: "row", alignItems: "center", gap: 6 },
  itemThumb: { width: 36, height: 36, borderRadius: 6 },
  itemThumbPlaceholder: { backgroundColor: "#ddd" },
  itemTitle: { fontSize: 12, color: "#555", maxWidth: 120 },
});
