import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { formatShippingAddress } from "@/lib/format-address";

interface OrderItem {
  id: string;
  quantity: number;
  storeItem?: { id: string; title: string; slug: string; photos: string[] };
}

interface StoreOrder {
  id: string;
  status: string;
  totalCents: number;
  createdAt: string;
  shippingAddress?: unknown;
  buyer?: { firstName: string; lastName: string; email: string };
  items?: OrderItem[];
}

function formatDate(s: string): string {
  try {
    const d = new Date(s);
    return d.toLocaleString();
  } catch {
    return s;
  }
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    setError(null);
    apiGet<StoreOrder | { error: string }>(`/api/store-orders/${id}`)
      .then((data) => {
        if (data && "error" in data) {
          setError((data as { error: string }).error);
          setOrder(null);
        } else {
          setOrder(data as StoreOrder);
        }
      })
      .catch(() => {
        setError("Failed to load order");
        setOrder(null);
      })
      .finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading && !order) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error || !order) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? "Order not found"}</Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Back to Orders</Text>
        </Pressable>
      </View>
    );
  }

  const buyerName = order.buyer
    ? `${order.buyer.firstName} ${order.buyer.lastName}`.trim() || "—"
    : "—";
  const buyerEmail = order.buyer?.email ?? "—";
  const buyerAddress = order.shippingAddress
    ? formatShippingAddress(order.shippingAddress) || "—"
    : "—";
  const firstItem = order.items?.[0]?.storeItem;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.label}>Time Placed</Text>
        <Text style={styles.value}>{formatDate(order.createdAt)}</Text>
      </View>

      {firstItem && (
        <View style={styles.section}>
          <Text style={styles.label}>View Sold Item Listing</Text>
          <Pressable
            style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.8 }]}
            onPress={() => router.push(`/product/${firstItem.slug}` as never)}
          >
            <Text style={styles.linkBtnText}>{firstItem.title}</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.label}>Order Number</Text>
        <Text style={styles.value}>#{order.id}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Buyer Name</Text>
        <Text style={styles.value}>{buyerName}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Buyer Address</Text>
        <Text style={styles.value}>{buyerAddress}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Buyer Email</Text>
        <Text style={styles.value}>{buyerEmail}</Text>
      </View>

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 40 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 16,
  },
  section: { marginBottom: 20 },
  label: {
    fontSize: 12,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  value: { fontSize: 16, color: "#333" },
  linkBtn: {
    paddingVertical: 8,
    paddingRight: 8,
    alignSelf: "flex-start",
  },
  linkBtnText: {
    fontSize: 16,
    color: theme.colors.primary,
    fontWeight: "500",
  },
  errorText: { fontSize: 16, color: "#666", textAlign: "center", marginBottom: 16 },
  backBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
  },
  backBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
