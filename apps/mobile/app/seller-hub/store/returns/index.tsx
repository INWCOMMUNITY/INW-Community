import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";

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
  refundRequestedAt: string | null;
  buyer: { firstName: string; lastName: string; email: string };
  items: OrderItem[];
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function ReturnsScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<StoreOrder[]>("/api/store-orders?mine=1")
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setOrders(arr.filter((o) => o.refundRequestedAt != null));
      })
      .catch(() => setOrders([]))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const issueRefund = async (orderId: string) => {
    setRefunding(orderId);
    setError(null);
    try {
      await apiPost(`/api/store-orders/${orderId}/refund`, {});
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Refund failed");
    } finally {
      setRefunding(null);
    }
  };

  if (loading && orders.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
      }
    >
      <Text style={styles.title}>Return Requests</Text>
      <Text style={styles.hint}>
        Issue refunds for orders. Refunds are deducted from your My Funds balance.
      </Text>

      {error && <Text style={styles.err}>{error}</Text>}

      {orders.length === 0 ? (
        <Text style={styles.empty}>No return requests at this time.</Text>
      ) : (
        orders.map((order) => {
          const buyerName = `${order.buyer?.firstName ?? ""} ${order.buyer?.lastName ?? ""}`.trim() || "Buyer";
          return (
            <View key={order.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.buyer}>{buyerName}</Text>
                  <Text style={styles.email}>{order.buyer?.email}</Text>
                  <Text style={styles.date}>{new Date(order.createdAt).toLocaleString()}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.total}>{formatPrice(order.totalCents)}</Text>
                  <Text style={styles.badge}>{order.status}</Text>
                </View>
              </View>
              <View style={styles.items}>
                <Text style={styles.itemsLabel}>Items</Text>
                {order.items?.map((oi) => (
                  <View key={oi.id} style={styles.itemRow}>
                    {oi.storeItem?.photos?.[0] && (
                      <Image source={{ uri: oi.storeItem.photos[0] }} style={styles.thumb} />
                    )}
                    <Text style={styles.itemText}>
                      {oi.storeItem?.title} × {oi.quantity} — {formatPrice(oi.priceCentsAtPurchase * oi.quantity)}
                    </Text>
                  </View>
                ))}
              </View>
              <Pressable
                style={({ pressed }) => [styles.refundBtn, pressed && { opacity: 0.8 }]}
                onPress={() => issueRefund(order.id)}
                disabled={refunding === order.id}
              >
                {refunding === order.id ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.refundBtnText}>Issue refund</Text>
                )}
              </Pressable>
            </View>
          );
        })
      )}

      <Pressable
        style={({ pressed }) => [styles.link, pressed && { opacity: 0.8 }]}
        onPress={() => (router.push as (href: string) => void)("/seller-hub/store/payouts")}
      >
        <Text style={styles.linkText}>View My Funds</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  hint: { fontSize: 14, color: "#666", marginBottom: 24 },
  err: { color: "#c62828", marginBottom: 16, fontSize: 14 },
  empty: { fontSize: 16, color: "#888" },
  card: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  buyer: { fontSize: 16, fontWeight: "600", color: "#333" },
  email: { fontSize: 14, color: "#666" },
  date: { fontSize: 12, color: "#888", marginTop: 4 },
  totalRow: { alignItems: "flex-end" },
  total: { fontSize: 18, fontWeight: "700", color: "#333" },
  badge: { fontSize: 12, backgroundColor: theme.colors.creamAlt, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, marginTop: 4, color: theme.colors.primary },
  items: { borderTopWidth: 1, borderTopColor: "#eee", paddingTop: 12 },
  itemsLabel: { fontSize: 14, fontWeight: "600", marginBottom: 8 },
  itemRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  thumb: { width: 40, height: 40, borderRadius: 4, marginRight: 8 },
  itemText: { fontSize: 14, color: "#333", flex: 1 },
  refundBtn: {
    marginTop: 16,
    backgroundColor: "#c62828",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  refundBtnText: { color: "#fff", fontWeight: "600" },
  link: { marginTop: 8 },
  linkText: { fontSize: 14, color: theme.colors.primary, fontWeight: "600" },
});
