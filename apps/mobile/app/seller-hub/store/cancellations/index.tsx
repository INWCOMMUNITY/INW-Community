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
  inventoryRestoredAt: string | null;
  stripePaymentIntentId: string | null;
  buyer: { firstName: string; lastName: string; email: string };
  items: OrderItem[];
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function CancellationsScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [relisting, setRelisting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<StoreOrder[]>("/api/store-orders?mine=1&canceled=1")
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .catch(() => setOrders([]))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const relistOrder = async (orderId: string) => {
    setRelisting(orderId);
    setError(null);
    try {
      await apiPost(`/api/store-orders/${orderId}/relist`, {});
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, inventoryRestoredAt: new Date().toISOString() } : o
        )
      );
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Re-list failed");
    } finally {
      setRelisting(null);
    }
  };

  const cashOrders = orders.filter((o) => !o.stripePaymentIntentId);
  const pendingRelist = cashOrders.filter((o) => !o.inventoryRestoredAt);
  const alreadyRelisted = cashOrders.filter((o) => o.inventoryRestoredAt);

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
      <Text style={styles.title}>Cancellations</Text>
      <Text style={styles.hint}>
        When a buyer cancels a cash order, inventory is not restored automatically. Re-list items
        when you are ready so they become available for sale again.
      </Text>

      {error && <Text style={styles.err}>{error}</Text>}

      {orders.length === 0 ? (
        <Text style={styles.empty}>No canceled orders.</Text>
      ) : cashOrders.length === 0 ? (
        <Text style={styles.empty}>
          No canceled cash orders. (Canceled card orders are refunded and inventory is restored
          automatically.)
        </Text>
      ) : (
        <>
          {pendingRelist.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Awaiting re-list</Text>
              {pendingRelist.map((order) => {
                const buyerName = `${order.buyer?.firstName ?? ""} ${order.buyer?.lastName ?? ""}`.trim() || "Buyer";
                return (
                  <View key={order.id} style={styles.card}>
                    <View style={styles.cardHeader}>
                      <View>
                        <Text style={styles.buyer}>{buyerName}</Text>
                        <Text style={styles.email}>{order.buyer?.email}</Text>
                        <Text style={styles.date}>
                          Canceled {new Date(order.createdAt).toLocaleString()}
                        </Text>
                      </View>
                      <View>
                        <Text style={styles.total}>{formatPrice(order.totalCents)}</Text>
                        <Text style={styles.cashBadge}>Cash order — re-list to restore inventory</Text>
                      </View>
                    </View>
                    <View style={styles.items}>
                      {order.items?.map((oi) => (
                        <View key={oi.id} style={styles.itemRow}>
                          {oi.storeItem?.photos?.[0] && (
                            <Image source={{ uri: oi.storeItem.photos[0] }} style={styles.thumb} />
                          )}
                          <Text style={styles.itemText}>
                            {oi.storeItem?.title} × {oi.quantity}
                          </Text>
                        </View>
                      ))}
                    </View>
                    <Pressable
                      style={({ pressed }) => [styles.relistBtn, pressed && { opacity: 0.8 }]}
                      onPress={() => relistOrder(order.id)}
                      disabled={relisting === order.id}
                    >
                      {relisting === order.id ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.relistBtnText}>Re-list items</Text>
                      )}
                    </Pressable>
                  </View>
                );
              })}
            </>
          )}
          {alreadyRelisted.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Already re-listed</Text>
              {alreadyRelisted.map((order) => {
                const buyerName = `${order.buyer?.firstName ?? ""} ${order.buyer?.lastName ?? ""}`.trim() || "Buyer";
                return (
                  <View key={order.id} style={[styles.card, styles.completedCard]}>
                    <View style={styles.cardHeader}>
                      <View>
                        <Text style={styles.buyer}>{buyerName}</Text>
                        <Text style={styles.date}>
                          Re-listed{" "}
                          {order.inventoryRestoredAt &&
                            new Date(order.inventoryRestoredAt).toLocaleString()}
                        </Text>
                      </View>
                      <Text style={styles.total}>{formatPrice(order.totalCents)}</Text>
                    </View>
                    <View style={styles.items}>
                      {order.items?.map((oi) => (
                        <Text key={oi.id} style={styles.itemTextSimple}>
                          {oi.storeItem?.title} × {oi.quantity}
                        </Text>
                      ))}
                    </View>
                  </View>
                );
              })}
            </>
          )}
        </>
      )}

      <Pressable
        style={({ pressed }) => [styles.link, pressed && { opacity: 0.8 }]}
        onPress={() => (router.push as (href: string) => void)("/seller-hub/store/items")}
      >
        <Text style={styles.linkText}>View My Items</Text>
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
  sectionTitle: { fontSize: 16, fontWeight: "600", marginBottom: 12, marginTop: 8, color: "#333" },
  card: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  completedCard: { borderColor: "#ddd", backgroundColor: "#f5f5f5" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  buyer: { fontSize: 16, fontWeight: "600", color: "#333" },
  email: { fontSize: 14, color: "#666" },
  date: { fontSize: 12, color: "#888", marginTop: 4 },
  total: { fontSize: 18, fontWeight: "700", color: "#333" },
  cashBadge: {
    fontSize: 11,
    backgroundColor: "#fef3c7",
    color: "#92400e",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginTop: 4,
  },
  items: { borderTopWidth: 1, borderTopColor: "#eee", paddingTop: 12 },
  itemRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  thumb: { width: 40, height: 40, borderRadius: 4, marginRight: 8 },
  itemText: { fontSize: 14, color: "#333", flex: 1 },
  itemTextSimple: { fontSize: 14, color: "#666", marginBottom: 4 },
  relistBtn: {
    marginTop: 16,
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  relistBtnText: { color: "#fff", fontWeight: "600" },
  link: { marginTop: 8 },
  linkText: { fontSize: 14, color: theme.colors.primary, fontWeight: "600" },
});
