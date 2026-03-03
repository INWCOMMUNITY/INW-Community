import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface StoreOrder {
  id: string;
  status: string;
  totalCents: number;
  createdAt: string;
  buyer?: { firstName: string; lastName: string };
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

export default function ResaleHubDeliveriesScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    apiGet<StoreOrder[] | { error: string }>("/api/store-orders?mine=1")
      .then((data) => setOrders(Array.isArray(data) ? data : []))
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
        Resale orders with local delivery will appear here. Mark them as delivered when you complete the drop-off.
      </Text>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No delivery orders right now.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
            onPress={() =>
              router.push(
                `/web?url=${encodeURIComponent(`${siteBase}/resale-hub/deliveries`)}&title=${encodeURIComponent("My Deliveries")}` as never
              )
            }
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
          </Pressable>
        )}
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
});
