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
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { formatShippingAddress } from "@/lib/format-address";
import { orderEligibleForAnotherShippoLabel } from "@/lib/shippo-order-label-eligibility";
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

interface Shipment {
  id: string;
  carrier?: string;
  trackingNumber?: string | null;
  labelUrl?: string | null;
  shippoOrderId?: string | null;
}

interface StoreOrder {
  id: string;
  status: string;
  totalCents: number;
  createdAt: string;
  shippingAddress?: unknown;
  buyer?: { firstName: string; lastName: string; email: string };
  items?: OrderItem[];
  shipment?: Shipment | null;
}

function formatDate(s: string): string {
  try {
    const d = new Date(s);
    return d.toLocaleString();
  } catch {
    return s;
  }
}

/** Expo Router can pass dynamic segments as `string | string[]` — only the first segment is a valid order id. */
function paramAsString(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v[0];
  return v;
}

export default function OrderDetailScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = paramAsString(params.id);
  const router = useRouter();
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setLoading(true);
    if (!id) {
      setOrder(null);
      setError("Missing order.");
      setLoading(false);
      return;
    }
    apiGet<StoreOrder>(`/api/store-orders/${encodeURIComponent(id)}`)
      .then((data) => {
        setOrder(data);
      })
      .catch((e) => {
        const err = e as { error?: string; status?: number };
        const msg = err.error ?? "Failed to load order";
        setError(err.status === 404 ? "Order not found." : msg);
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

  const canceledOrRefunded =
    order.status === "canceled" || order.status === "refunded" || order.status === "cancelled";
  /** Seller label tools for orders in a shippable lifecycle (not only when `shipment` is present). */
  const showShippingLabels =
    !canceledOrRefunded &&
    (order.status === "paid" || order.status === "shipped" || order.status === "delivered");
  const showPurchaseAnother = orderEligibleForAnotherShippoLabel(order);

  const openListing = (slug: string, listingType?: string) => {
    const q = listingType === "resale" ? "?listingType=resale" : "";
    router.push(`/product/${slug}${q}` as never);
  };

  const openShippoLabelFullScreen = (mode: "reprint" | "purchase" | "another") => {
    router.push(`/seller-hub/shippo-order/${order.id}?mode=${mode}` as never);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.label}>Time Placed</Text>
        <Text style={styles.value}>{formatDate(order.createdAt)}</Text>
      </View>

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

      {showShippingLabels && (
        <View style={styles.section}>
          <Text style={styles.label}>Shipping & labels</Text>
          <Text style={styles.valueHint}>
            {showPurchaseAnother || order.shipment
              ? "Buy another label to the same address, or reprint while the window is open. Shippo opens full screen."
              : "Opens a full-screen label screen; sign in with your connected Shippo account when prompted."}
          </Text>

          {(order.shipment || showPurchaseAnother) && (
            <View style={styles.shipDetailsCard}>
              <Text style={styles.shipDetailsTitle}>Ship to (for labels)</Text>
              <Text style={styles.shipDetailsBody}>{buyerAddress}</Text>
              {order.shipment && (order.shipment.carrier || order.shipment.trackingNumber) ? (
                <Text style={styles.shipDetailsMeta}>
                  {[order.shipment.carrier, order.shipment.trackingNumber].filter(Boolean).join(" · ")}
                </Text>
              ) : null}
            </View>
          )}

          <View style={styles.labelBtnRow}>
            {order.shipment?.shippoOrderId ? (
              <Pressable
                style={({ pressed }) => [styles.labelBtn, pressed && { opacity: 0.8 }]}
                onPress={() => openShippoLabelFullScreen("reprint")}
              >
                <Ionicons name="print-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.labelBtnText}>Reprint label</Text>
              </Pressable>
            ) : null}
            {!order.shipment && order.status === "paid" ? (
              <Pressable
                style={({ pressed }) => [styles.labelBtn, pressed && { opacity: 0.8 }]}
                onPress={() => openShippoLabelFullScreen("purchase")}
              >
                <Text style={styles.labelBtnText}>Purchase labels</Text>
              </Pressable>
            ) : null}
            {showPurchaseAnother ? (
              <Pressable
                style={({ pressed }) => [styles.labelBtnSecondary, pressed && { opacity: 0.85 }]}
                onPress={() => openShippoLabelFullScreen("another")}
              >
                <Ionicons name="cube-outline" size={18} color={theme.colors.primary} style={{ marginRight: 6 }} />
                <Text style={styles.labelBtnSecondaryText}>Purchase another label</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

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
  valueHint: { fontSize: 14, color: "#666", marginBottom: 12 },
  labelBtnRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  labelBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  labelBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  labelBtnSecondary: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  labelBtnSecondaryText: { color: theme.colors.primary, fontSize: 14, fontWeight: "600" },
  shipDetailsCard: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    backgroundColor: "#fafafa",
  },
  shipDetailsTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#555",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  shipDetailsBody: { fontSize: 15, color: "#333", lineHeight: 22 },
  shipDetailsMeta: { fontSize: 13, color: "#666", marginTop: 8 },
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
