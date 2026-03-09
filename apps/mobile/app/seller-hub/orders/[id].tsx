import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { formatShippingAddress } from "@/lib/format-address";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

interface OrderItem {
  id: string;
  quantity: number;
  storeItem?: { id: string; title: string; slug: string; photos: string[]; listingType?: string };
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

  const openListing = (slug: string, listingType?: string) => {
    const q = listingType === "resale" ? "?listingType=resale" : "";
    router.push(`/product/${slug}${q}` as never);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.label}>Time Placed</Text>
        <Text style={styles.value}>{formatDate(order.createdAt)}</Text>
      </View>

      {(order.items?.length ?? 0) > 0 && (
        <View style={styles.section}>
          <Text style={styles.label}>Items in this order</Text>
          {(order.items ?? []).map((oi) => {
            const si = oi.storeItem;
            const photoUrl = si?.photos?.[0] ? resolvePhotoUrl(si.photos[0]) : undefined;
            return (
              <Pressable
                key={oi.id}
                style={({ pressed }) => [styles.itemRow, pressed && { opacity: 0.8 }]}
                onPress={() => si && openListing(si.slug, si.listingType ?? undefined)}
              >
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={styles.itemThumb} />
                ) : (
                  <View style={[styles.itemThumb, styles.itemThumbPlaceholder]} />
                )}
                <View style={styles.itemBody}>
                  <Text style={styles.itemTitle}>{si?.title ?? "Item"} × {oi.quantity}</Text>
                  <Text style={styles.linkBtnText}>View in-app listing</Text>
                </View>
              </Pressable>
            );
          })}
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
    fontSize: 14,
    color: theme.colors.primary,
    fontWeight: "500",
    marginTop: 2,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
  },
  itemThumb: { width: 48, height: 48, borderRadius: 8, marginRight: 12 },
  itemThumbPlaceholder: { backgroundColor: "#ddd" },
  itemBody: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 16, color: "#333" },
  errorText: { fontSize: 16, color: "#666", textAlign: "center", marginBottom: 16 },
  backBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
  },
  backBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
