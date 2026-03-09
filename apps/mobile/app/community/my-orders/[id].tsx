import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Linking,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { formatShippingAddress } from "@/lib/format-address";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface OrderItemRow {
  id: string;
  quantity: number;
  priceCentsAtPurchase: number;
  storeItem?: { id: string; title: string; slug: string; photos: string[] };
}

interface StoreOrder {
  id: string;
  status: string;
  totalCents: number;
  shippingCostCents?: number;
  createdAt: string;
  shippingAddress?: unknown;
  seller?: {
    firstName: string;
    lastName: string;
    businesses: { name: string; slug: string }[];
  };
  items?: OrderItemRow[];
  shipment?: { trackingNumber?: string | null; carrier?: string } | null;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

export default function MyOrderDetailScreen() {
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
          <Text style={styles.backBtnText}>Back to My Orders</Text>
        </Pressable>
      </View>
    );
  }

  const sellerName =
    order.seller?.businesses?.[0]?.name ??
    (`${order.seller?.firstName ?? ""} ${order.seller?.lastName ?? ""}`.trim() || "Seller");
  const shippingAddressStr = order.shippingAddress
    ? formatShippingAddress(order.shippingAddress)
    : null;
  const trackingNumber = order.shipment?.trackingNumber?.trim();
  const trackingUrl = trackingNumber
    ? `https://www.google.com/search?q=track+${encodeURIComponent(trackingNumber)}`
    : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.label}>Order #</Text>
        <Text style={styles.value}>#{order.id.slice(-8).toUpperCase()}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Status</Text>
        <Text style={[styles.value, styles.statusCapitalize]}>{order.status}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Placed</Text>
        <Text style={styles.value}>{formatDate(order.createdAt)}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Seller</Text>
        <Text style={styles.value}>{sellerName}</Text>
      </View>

      {order.items && order.items.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.label}>Items</Text>
          {order.items.map((oi) => {
            const photoUrl = oi.storeItem?.photos?.[0]
              ? resolvePhotoUrl(oi.storeItem.photos[0])
              : undefined;
            return (
              <View key={oi.id} style={styles.itemRow}>
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={styles.itemThumb} />
                ) : (
                  <View style={[styles.itemThumb, styles.itemThumbPlaceholder]}>
                    <Text style={styles.itemThumbText}>
                      {oi.storeItem?.title?.[0] ?? "?"}
                    </Text>
                  </View>
                )}
                <View style={styles.itemBody}>
                  <Text style={styles.itemTitle}>
                    {oi.storeItem?.title ?? "Item"} × {oi.quantity}
                  </Text>
                  <Text style={styles.itemPrice}>
                    {formatPrice(oi.priceCentsAtPurchase * oi.quantity)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {order.shippingCostCents != null && order.shippingCostCents > 0 && (
        <View style={styles.section}>
          <Text style={styles.label}>Shipping</Text>
          <Text style={styles.value}>{formatPrice(order.shippingCostCents)}</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.label}>Total</Text>
        <Text style={styles.totalValue}>{formatPrice(order.totalCents)}</Text>
      </View>

      {shippingAddressStr && (
        <View style={styles.section}>
          <Text style={styles.label}>Shipping address</Text>
          <Text style={styles.value}>{shippingAddressStr}</Text>
        </View>
      )}

      {trackingNumber && (
        <View style={styles.section}>
          <Text style={styles.label}>Tracking</Text>
          <Text style={styles.value}>
            {order.shipment?.carrier && `${order.shipment.carrier} — `}
            {trackingNumber}
          </Text>
          {trackingUrl && (
            <Pressable
              style={({ pressed }) => [styles.trackBtn, pressed && { opacity: 0.8 }]}
              onPress={() => Linking.openURL(trackingUrl)}
            >
              <Ionicons name="open-outline" size={18} color="#fff" />
              <Text style={styles.trackBtnText}>Track shipment</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={{ height: 32 }} />
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
  statusCapitalize: { textTransform: "capitalize" },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  itemThumb: { width: 48, height: 48, borderRadius: 8, marginRight: 12 },
  itemThumbPlaceholder: {
    backgroundColor: theme.colors.cream,
    justifyContent: "center",
    alignItems: "center",
  },
  itemThumbText: { fontSize: 18, fontWeight: "600", color: theme.colors.primary },
  itemBody: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 15, color: "#333" },
  itemPrice: { fontSize: 15, fontWeight: "600", color: theme.colors.primary, marginTop: 2 },
  totalValue: { fontSize: 18, fontWeight: "700", color: theme.colors.primary },
  trackBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    alignSelf: "flex-start",
  },
  trackBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  errorText: { fontSize: 16, color: "#666", textAlign: "center", marginBottom: 16 },
  backBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
  },
  backBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
