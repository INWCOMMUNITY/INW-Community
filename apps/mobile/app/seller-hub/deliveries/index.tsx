import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Image,
  Alert,
  Modal,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { BadgeEarnedPopup } from "@/components/BadgeEarnedPopup";
import { Ionicons } from "@expo/vector-icons";
interface LocalDeliveryDetails {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  deliveryAddress?: { street?: string; city?: string; state?: string; zip?: string };
  availableDropOffTimes?: string;
  note?: string;
}

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

interface OrderWithDelivery {
  id: string;
  status: string;
  createdAt: string;
  totalCents: number;
  stripePaymentIntentId?: string | null;
  localDeliveryDetails: LocalDeliveryDetails | null;
  deliveryConfirmedAt: string | null;
  deliveryBuyerConfirmedAt?: string | null;
  items: {
    id?: string;
    fulfillmentType?: string | null;
    storeItem: { title: string; photos?: string[] };
    quantity: number;
  }[];
}

function canSellerCancelDeliveryFromMenu(o: OrderWithDelivery): boolean {
  if (o.status !== "paid") return false;
  if (o.deliveryConfirmedAt) return false;
  if (o.localDeliveryDetails == null) return false;
  return o.items.some((i) => (i.fulfillmentType ?? "") === "local_delivery");
}

/** API only allows fulfillment updates once the order is paid (or later). */
function sellerCanMarkLocalDelivery(o: OrderWithDelivery): boolean {
  if (o.deliveryConfirmedAt) return false;
  return ["paid", "shipped", "delivered"].includes(o.status);
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
  const [earnedBadges, setEarnedBadges] = useState<
    { slug: string; name: string; description?: string }[]
  >([]);
  const [badgePopupIndex, setBadgePopupIndex] = useState(-1);
  const [deliveryMenuOrderId, setDeliveryMenuOrderId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

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
      const path = `/api/store-orders/${encodeURIComponent(orderId)}`;
      const res = await apiPatch<{
        earnedBadges?: { slug: string; name: string; description?: string }[];
      }>(path, { deliveryConfirmed: true });
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? { ...o, deliveryConfirmedAt: new Date().toISOString(), deliveryBuyerConfirmedAt: o.deliveryBuyerConfirmedAt ?? null }
            : o
        )
      );
      if (res?.earnedBadges?.length) {
        setEarnedBadges(res.earnedBadges);
        setBadgePopupIndex(0);
      }
    } catch (e) {
      const msg =
        typeof e === "object" && e !== null && "error" in e && typeof (e as { error?: string }).error === "string"
          ? (e as { error: string }).error
          : "Could not update this order. Try again.";
      Alert.alert("Mark delivered", msg);
    } finally {
      setConfirmingId(null);
    }
  };

  const cancelLocalDelivery = (orderId: string) => {
    const o = orders.find((x) => x.id === orderId);
    const paidOnline = Boolean(o?.stripePaymentIntentId);
    Alert.alert(
      "Cancel this delivery?",
      paidOnline
        ? "The buyer will be refunded to their card and listing quantities will be restored. This cannot be undone."
        : "The cash order will be canceled and quantities restored. Confirm with the buyer if they already paid you in person.",
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Cancel delivery",
          style: "destructive",
          onPress: async () => {
            setDeliveryMenuOrderId(null);
            setCancelingId(orderId);
            try {
              await apiPost(`/api/store-orders/${encodeURIComponent(orderId)}/seller-cancel-local-delivery`, {});
              setOrders((prev) => prev.filter((x) => x.id !== orderId));
            } catch (e) {
              const msg =
                typeof e === "object" && e !== null && "error" in e && typeof (e as { error?: string }).error === "string"
                  ? (e as { error: string }).error
                  : "Could not cancel this order. Try again or contact support.";
              Alert.alert("Cancel delivery", msg);
            } finally {
              setCancelingId(null);
            }
          },
        },
      ]
    );
  };

  const pending = orders.filter(
    (o) => !(o.deliveryConfirmedAt && o.deliveryBuyerConfirmedAt)
  );
  const completed = orders.filter(
    (o) => o.deliveryConfirmedAt && o.deliveryBuyerConfirmedAt
  );

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
                    <View style={styles.cardHeaderRow}>
                      <View style={styles.cardHeaderTitles}>
                        <Text style={styles.orderId}>#{o.id.slice(-6)}</Text>
                        <Text style={styles.date}>{new Date(o.createdAt).toLocaleDateString()}</Text>
                      </View>
                      {canSellerCancelDeliveryFromMenu(o) ? (
                        <Pressable
                          accessibilityLabel="Delivery options"
                          hitSlop={10}
                          style={({ pressed }) => [styles.cardMenuBtn, pressed && { opacity: 0.7 }]}
                          onPress={() => setDeliveryMenuOrderId(o.id)}
                          disabled={cancelingId === o.id}
                        >
                          <Ionicons name="ellipsis-vertical" size={22} color={theme.colors.heading} />
                        </Pressable>
                      ) : null}
                    </View>
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
                    {d.email ? (
                      <>
                        <Text style={styles.label}>Email</Text>
                        <Text style={styles.value}>{d.email}</Text>
                      </>
                    ) : null}
                    {d.availableDropOffTimes ? (
                      <>
                        <Text style={styles.label}>Available drop-off times</Text>
                        <Text style={styles.value}>{d.availableDropOffTimes}</Text>
                      </>
                    ) : null}
                    <Text style={styles.label}>Confirmation</Text>
                    <Text style={styles.value}>
                      Seller delivered: {o.deliveryConfirmedAt ? "Yes" : "No"} · Buyer received:{" "}
                      {o.deliveryBuyerConfirmedAt ? "Yes" : "No"}
                    </Text>
                    <Text style={styles.label}>Items</Text>
                    <View style={styles.itemsRow}>
                      {o.items.map((i, idx) => {
                        const photoUrl = resolvePhotoUrl(i.storeItem?.photos?.[0]);
                        return (
                          <View key={i.id ?? `item-${idx}`} style={styles.itemRow}>
                            {photoUrl ? (
                              <Image source={{ uri: photoUrl }} style={styles.itemThumb} />
                            ) : (
                              <View style={[styles.itemThumb, styles.itemThumbPlaceholder]} />
                            )}
                            <Text style={styles.itemText}>
                              {i.storeItem?.title} × {i.quantity}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                    {!o.deliveryConfirmedAt && sellerCanMarkLocalDelivery(o) ? (
                      <Pressable
                        style={({ pressed }) => [styles.btn, pressed && { opacity: 0.8 }]}
                        onPress={() => markDelivered(o.id)}
                        disabled={confirmingId === o.id}
                      >
                        {confirmingId === o.id ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text style={styles.btnText}>Mark delivered (seller)</Text>
                        )}
                      </Pressable>
                    ) : !o.deliveryConfirmedAt ? (
                      <Text style={styles.cannotMarkYet}>
                        {o.status === "pending"
                          ? "This order is not paid yet. After the buyer pays (online or cash), you can mark it delivered here."
                          : "This order can’t be marked delivered in its current state."}
                      </Text>
                    ) : (
                      <Pressable style={styles.btnMarked} disabled accessibilityState={{ disabled: true }}>
                        <Text style={styles.btnMarkedText}>Marked Delivered</Text>
                      </Pressable>
                    )}
                    {o.deliveryConfirmedAt && !o.deliveryBuyerConfirmedAt ? (
                      <Text style={styles.waiting}>Waiting for buyer to confirm receipt.</Text>
                    ) : null}
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
      {badgePopupIndex >= 0 && badgePopupIndex < earnedBadges.length && (
        <BadgeEarnedPopup
          visible
          onClose={() => {
            const next = badgePopupIndex + 1;
            if (next < earnedBadges.length) {
              setBadgePopupIndex(next);
            } else {
              setBadgePopupIndex(-1);
              setEarnedBadges([]);
            }
          }}
          badgeName={earnedBadges[badgePopupIndex].name}
          badgeSlug={earnedBadges[badgePopupIndex].slug}
          badgeDescription={earnedBadges[badgePopupIndex].description}
        />
      )}
      <Modal
        visible={deliveryMenuOrderId != null}
        transparent
        animationType="fade"
        onRequestClose={() => setDeliveryMenuOrderId(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setDeliveryMenuOrderId(null)}>
          <View onStartShouldSetResponder={() => true} style={styles.modalSheet}>
            <Pressable
              style={({ pressed }) => [styles.modalRowDanger, pressed && { opacity: 0.85 }]}
              onPress={() => {
                if (deliveryMenuOrderId) cancelLocalDelivery(deliveryMenuOrderId);
              }}
            >
              <Text style={styles.modalRowDangerText}>Cancel delivery</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.modalRow, pressed && { opacity: 0.85 }]}
              onPress={() => setDeliveryMenuOrderId(null)}
            >
              <Text style={styles.modalRowText}>Close</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
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
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 4,
  },
  cardHeaderTitles: { flex: 1, minWidth: 0 },
  cardMenuBtn: { padding: 4, marginTop: -4, marginRight: -4 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
    padding: 16,
    paddingBottom: 32,
  },
  modalSheet: {
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  modalRow: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  modalRowText: { fontSize: 16, textAlign: "center", color: theme.colors.heading },
  modalRowDanger: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  modalRowDangerText: { fontSize: 16, textAlign: "center", color: "#b91c1c", fontWeight: "600" },
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
  btnMarked: {
    marginTop: 16,
    backgroundColor: "#e5e8e0",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#c5c9be",
  },
  btnMarkedText: { color: theme.colors.heading, fontWeight: "600", fontSize: 15 },
  cannotMarkYet: {
    marginTop: 16,
    fontSize: 14,
    color: "#92400e",
    lineHeight: 20,
  },
  waiting: { fontSize: 14, color: "#92400e", marginTop: 12, fontStyle: "italic" },
  toggle: { marginBottom: 12 },
  toggleText: { fontSize: 14, color: theme.colors.primary, fontWeight: "600" },
  itemsRow: { marginTop: 4 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  itemThumb: { width: 32, height: 32, borderRadius: 6 },
  itemThumbPlaceholder: { backgroundColor: "#ddd" },
  itemText: { fontSize: 14, color: "#333", flex: 1 },
});
