import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch } from "@/lib/api";
interface LocalDeliveryDetails {
  firstName?: string;
  lastName?: string;
  phone?: string;
  deliveryAddress?: { street?: string; city?: string; state?: string; zip?: string };
  note?: string;
}

interface OrderWithDelivery {
  id: string;
  createdAt: string;
  totalCents: number;
  localDeliveryDetails: LocalDeliveryDetails | null;
  deliveryConfirmedAt: string | null;
  items: { storeItem: { title: string }; quantity: number }[];
}

function formatAddr(d: LocalDeliveryDetails | null): string {
  if (!d?.deliveryAddress) return "—";
  const a = d.deliveryAddress;
  return [a.street, a.city, a.state, a.zip].filter(Boolean).join(", ") || "—";
}

export default function DeliveriesScreen() {
  const [orders, setOrders] = useState<OrderWithDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  const load = useCallback(() => {
    apiGet<OrderWithDelivery[]>("/api/store-orders?mine=1")
      .then((data) => {
        const withDelivery = (Array.isArray(data) ? data : []).filter(
          (o) => o.localDeliveryDetails != null && typeof o.localDeliveryDetails === "object"
        );
        setOrders(withDelivery);
      })
      .catch(() => setOrders([]))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const markDelivered = async (orderId: string) => {
    setConfirmingId(orderId);
    try {
      await apiPatch(`/api/store-orders/${orderId}`, { deliveryConfirmed: true });
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, deliveryConfirmedAt: new Date().toISOString() } : o
        )
      );
    } catch {
      // error
    } finally {
      setConfirmingId(null);
    }
  };

  const pending = orders.filter((o) => !o.deliveryConfirmedAt);
  const completed = orders.filter((o) => o.deliveryConfirmedAt);

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
      <Text style={styles.title}>My Deliveries</Text>
      <Text style={styles.hint}>
        Local delivery orders. Mark as delivered when you have completed the delivery.
      </Text>

      {orders.length === 0 ? (
        <Text style={styles.empty}>No orders with local delivery.</Text>
      ) : (
        <>
          {pending.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Pending delivery</Text>
              {pending.map((o) => {
                const d = (o.localDeliveryDetails || {}) as LocalDeliveryDetails;
                const name = [d.firstName, d.lastName].filter(Boolean).join(" ") || "Customer";
                return (
                  <View key={o.id} style={styles.card}>
                    <Text style={styles.orderId}>#{o.id.slice(-6)}</Text>
                    <Text style={styles.date}>{new Date(o.createdAt).toLocaleDateString()}</Text>
                    <Text style={styles.label}>Name</Text>
                    <Text style={styles.value}>{name}</Text>
                    <Text style={styles.label}>Address</Text>
                    <Text style={styles.value}>{formatAddr(o.localDeliveryDetails)}</Text>
                    {d.phone && (
                      <>
                        <Text style={styles.label}>Phone</Text>
                        <Text style={styles.value}>{d.phone}</Text>
                      </>
                    )}
                    <Text style={styles.label}>Items</Text>
                    <Text style={styles.value}>
                      {o.items.map((i) => `${i.storeItem.title} × ${i.quantity}`).join(", ")}
                    </Text>
                    <Pressable
                      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.8 }]}
                      onPress={() => markDelivered(o.id)}
                      disabled={confirmingId === o.id}
                    >
                      {confirmingId === o.id ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.btnText}>Order Delivered</Text>
                      )}
                    </Pressable>
                  </View>
                );
              })}
            </>
          )}
          {completed.length > 0 && (
            <>
              <Pressable
                style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.8 }]}
                onPress={() => setShowCompleted((s) => !s)}
              >
                <Text style={styles.toggleText}>
                  {showCompleted ? "Hide" : "Show"} completed ({completed.length})
                </Text>
              </Pressable>
              {showCompleted &&
                completed.map((o) => {
                  const d = (o.localDeliveryDetails || {}) as LocalDeliveryDetails;
                  const name = [d.firstName, d.lastName].filter(Boolean).join(" ") || "Customer";
                  return (
                    <View key={o.id} style={[styles.card, styles.completedCard]}>
                      <Text style={styles.orderId}>#{o.id.slice(-6)}</Text>
                      <Text style={styles.date}>{new Date(o.createdAt).toLocaleDateString()}</Text>
                      <Text style={styles.value}>{name}</Text>
                      <Text style={styles.delivered}>
                        Delivered {o.deliveryConfirmedAt && new Date(o.deliveryConfirmedAt).toLocaleDateString()}
                      </Text>
                    </View>
                  );
                })}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  hint: { fontSize: 14, color: "#666", marginBottom: 24 },
  empty: { fontSize: 16, color: "#888" },
  sectionTitle: { fontSize: 16, fontWeight: "600", marginBottom: 12, color: "#333" },
  card: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  completedCard: { backgroundColor: "#f0f0f0" },
  orderId: { fontSize: 14, fontWeight: "600", color: theme.colors.primary, marginBottom: 4 },
  date: { fontSize: 12, color: "#666", marginBottom: 12 },
  label: { fontSize: 12, color: "#888", marginTop: 8 },
  value: { fontSize: 14, color: "#333" },
  delivered: { fontSize: 12, color: "#2e7d32", marginTop: 8 },
  btn: {
    marginTop: 16,
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "600" },
  toggle: { marginBottom: 12 },
  toggleText: { fontSize: 14, color: theme.colors.primary, fontWeight: "600" },
});
