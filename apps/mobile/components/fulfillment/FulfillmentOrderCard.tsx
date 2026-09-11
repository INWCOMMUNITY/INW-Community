import React from "react";
import { View, Text, Pressable, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { getStoreOrderStatusLabel } from "@/lib/order-status";
import {
  formatSellerOrderTotal,
  sellerOrderPaymentLabel,
  orderFulfillmentBadge,
} from "@/lib/store-order-fulfillment";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

export type FulfillmentOrderCardOrder = {
  id: string;
  orderNumber?: string;
  orderKind?: string;
  status: string;
  totalCents: number;
  taxCents?: number;
  createdAt: string;
  stripePaymentIntentId?: string | null;
  refundInitiatedAt?: string | null;
  refundCompletedAt?: string | null;
  buyer?: { firstName?: string; lastName?: string };
  items?: Array<{
    quantity: number;
    fulfillmentType?: string | null;
    storeItem?: { title?: string; photos?: string[] };
  }>;
};

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString();
  } catch {
    return s;
  }
}

export function FulfillmentOrderCard({
  order,
  onPress,
  showStatus = true,
  trailing,
  menu,
  selectable,
  selected,
  onToggleSelect,
  address,
}: {
  order: FulfillmentOrderCardOrder;
  onPress: () => void;
  showStatus?: boolean;
  trailing?: React.ReactNode;
  menu?: React.ReactNode;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  address?: string | null;
}) {
  const orderNum = order.orderNumber ?? order.id.slice(-8).toUpperCase();
  const allPhotos = (order.items ?? [])
    .flatMap((item) => item.storeItem?.photos ?? [])
    .map(resolvePhotoUrl)
    .filter((src): src is string => !!src);
  const photos = allPhotos.slice(0, 4);
  const extraPhotoCount = Math.max(0, allPhotos.length - photos.length);
  const itemSummary = (order.items ?? [])
    .map((item) => `${item.storeItem?.title ?? "Item"} × ${item.quantity}`)
    .join(" · ");
  const buyerName =
    [order.buyer?.firstName, order.buyer?.lastName].filter(Boolean).join(" ") || "Customer";

  return (
    <View style={[styles.card, selected && styles.cardSelected]}>
      <View style={styles.header}>
        {selectable ? (
          <Pressable
            onPress={onToggleSelect}
            style={({ pressed }) => [styles.checkboxHit, pressed && { opacity: 0.7 }]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!selected }}
            accessibilityLabel={`Select order ${orderNum}`}
          >
            <Ionicons
              name={selected ? "checkbox" : "square-outline"}
              size={26}
              color={selected ? theme.colors.primary : "#888"}
            />
          </Pressable>
        ) : null}
        <Pressable
          style={({ pressed }) => [styles.headerMain, pressed && { opacity: 0.92 }]}
          onPress={onPress}
        >
          <View style={styles.titleRow}>
            <Text style={styles.orderId} numberOfLines={1}>
              Order #{orderNum}
            </Text>
            <Text style={styles.total}>{formatSellerOrderTotal(order)}</Text>
          </View>
          {order.orderKind === "reward_redemption" ? (
            <Text style={styles.reward}>Reward</Text>
          ) : null}
          <Text style={styles.meta} numberOfLines={1}>
            {buyerName} · {formatDate(order.createdAt)}
          </Text>
        </Pressable>
        {menu ? <View style={styles.menu}>{menu}</View> : null}
      </View>

      <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.92 }}>
        <View style={styles.photos}>
          {photos.length > 0 ? (
            photos.map((src, idx) => {
              const isLast = idx === photos.length - 1 && extraPhotoCount > 0;
              return (
                <View key={`${src}-${idx}`} style={styles.thumbWrap}>
                  <Image source={{ uri: src }} style={styles.thumb} resizeMode="cover" />
                  {isLast ? (
                    <View style={styles.extraOverlay}>
                      <Text style={styles.extraText}>+{extraPhotoCount}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })
          ) : (
            <View style={[styles.thumbWrap, styles.thumbPlaceholder]} />
          )}
        </View>
        <Text style={styles.summary} numberOfLines={2}>
          {itemSummary || "—"}
        </Text>
        {address ? (
          <Text style={styles.address} numberOfLines={2}>
            {address}
          </Text>
        ) : null}
        <View style={styles.chips}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>{sellerOrderPaymentLabel(order)}</Text>
          </View>
          <View style={styles.chipMuted}>
            <Text style={styles.chipMutedText}>{orderFulfillmentBadge(order)}</Text>
          </View>
          {showStatus ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{getStoreOrderStatusLabel(order)}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const THUMB = 56;

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e0d6",
    padding: 14,
    marginBottom: 12,
  },
  cardSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: "#f7f6f2",
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  checkboxHit: { paddingTop: 1, paddingRight: 2 },
  headerMain: { flex: 1, minWidth: 0 },
  menu: { marginTop: -2, marginRight: -4 },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  orderId: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: "700", color: theme.colors.primary },
  total: { fontSize: 15, fontWeight: "700", color: theme.colors.heading },
  reward: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: "#b45309",
  },
  meta: { marginTop: 3, fontSize: 13, color: "#666" },
  photos: { flexDirection: "row", flexWrap: "nowrap", gap: 6, marginTop: 12 },
  thumbWrap: {
    width: THUMB,
    height: THUMB,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#ece8e0",
  },
  thumb: { width: "100%", height: "100%" },
  thumbPlaceholder: { backgroundColor: "#ece8e0" },
  extraOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(62, 67, 47, 0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  extraText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  summary: { marginTop: 10, fontSize: 13, color: "#444", lineHeight: 18 },
  address: { marginTop: 4, fontSize: 13, color: "#777", lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: {
    backgroundColor: theme.colors.cream,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  chipText: { fontSize: 11, fontWeight: "600", color: theme.colors.primary },
  chipMuted: {
    backgroundColor: "#f3f1ed",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  chipMutedText: { fontSize: 11, fontWeight: "600", color: "#555" },
  trailing: { marginTop: 12, gap: 8 },
});
