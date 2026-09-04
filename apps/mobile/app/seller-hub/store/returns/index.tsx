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
  Alert,
  TextInput,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";

interface OrderItem {
  id: string;
  quantity: number;
  fulfillmentType?: string | null;
  storeItem: { id: string; title: string; slug: string; photos: string[] };
}

interface StoreReturn {
  id: string;
  status: string;
  reason?: string | null;
  chargeReturnShipping: boolean;
  returnLabelCostCents: number;
}

interface StoreOrder {
  id: string;
  totalCents: number;
  taxCents?: number;
  status: string;
  createdAt: string;
  buyer: { firstName: string; lastName: string; email: string };
  items: OrderItem[];
  storeReturn?: StoreReturn | null;
  returnShipment?: { labelUrl?: string | null; labelCostCents?: number } | null;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function statusCopy(status?: string): string {
  if (status === "requested") return "Buyer requested a return";
  if (status === "awaiting_return") return "Approved — waiting for the item";
  if (status === "in_transit") return "Return in transit";
  if (status === "received") return "Received — refunding";
  return status ?? "";
}

export default function ReturnsScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  const load = useCallback(() => {
    apiGet<StoreOrder[]>("/api/store-orders?mine=1&returns=1")
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .catch(() => setOrders([]))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const act = async (orderId: string, path: string, body?: object) => {
    setBusyId(orderId);
    setError(null);
    try {
      await apiPost(`/api/store-orders/${orderId}${path}`, body ?? {});
      load();
    } catch (e: unknown) {
      setError((e as { error?: string }).error ?? "Action failed");
    } finally {
      setBusyId(null);
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
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <Text style={styles.intro}>
        Approve a return, send a Shippo return label, then refund after you receive the item.
        Courtesy refunds send money back now; the buyer keeps the item.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {orders.length === 0 ? (
        <Text style={styles.empty}>No open return requests.</Text>
      ) : (
        orders.map((order) => {
          const ret = order.storeReturn;
          const busy = busyId === order.id;
          const hasShip = order.items.some((i) => (i.fulfillmentType ?? "ship") === "ship");
          return (
            <View key={order.id} style={styles.card}>
              <Text style={styles.buyer}>
                {order.buyer.firstName} {order.buyer.lastName}
              </Text>
              <Text style={styles.meta}>{statusCopy(ret?.status)}</Text>
              {ret?.reason ? <Text style={styles.meta}>Reason: {ret.reason}</Text> : null}
              <Text style={styles.total}>{formatPrice(order.totalCents + (order.taxCents ?? 0))}</Text>
              {order.items.map((oi) => (
                <View key={oi.id} style={styles.itemRow}>
                  {oi.storeItem.photos[0] ? (
                    <Image source={{ uri: oi.storeItem.photos[0] }} style={styles.thumb} />
                  ) : null}
                  <Text style={styles.itemTitle}>
                    {oi.storeItem.title} × {oi.quantity}
                  </Text>
                </View>
              ))}
              {ret?.status === "requested" ? (
                <View style={styles.actions}>
                  <Pressable style={styles.btn} disabled={busy} onPress={() => act(order.id, "/returns/approve")}>
                    <Text style={styles.btnText}>{busy ? "Working…" : "Approve return"}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.btnOutline}
                    disabled={busy}
                    onPress={() => {
                      setDeclineFor(order.id);
                      setDeclineReason("");
                    }}
                  >
                    <Text style={styles.btnOutlineText}>Decline</Text>
                  </Pressable>
                  <Pressable
                    style={styles.btnOutline}
                    disabled={busy}
                    onPress={() =>
                      Alert.alert("Courtesy refund", "Refund now and let the buyer keep the item?", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Refund", onPress: () => act(order.id, "/refund", { requireReturn: false }) },
                      ])
                    }
                  >
                    <Text style={styles.btnOutlineText}>Courtesy refund</Text>
                  </Pressable>
                </View>
              ) : null}
              {ret?.status === "awaiting_return" || ret?.status === "in_transit" ? (
                <View style={styles.actions}>
                  {hasShip && !order.returnShipment?.labelUrl ? (
                    <Pressable
                      style={styles.btn}
                      onPress={() =>
                        router.push(`/seller-hub/shippo-order/${order.id}?mode=return` as never)
                      }
                    >
                      <Text style={styles.btnText}>Buy return label</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={styles.btn}
                    disabled={busy}
                    onPress={() => act(order.id, "/returns/receive")}
                  >
                    <Text style={styles.btnText}>{busy ? "Refunding…" : "Mark received & refund"}</Text>
                  </Pressable>
                </View>
              ) : null}
              {declineFor === order.id ? (
                <View style={{ marginTop: 10 }}>
                  <TextInput
                    style={styles.input}
                    placeholder="Tell the buyer why"
                    value={declineReason}
                    onChangeText={setDeclineReason}
                    multiline
                  />
                  <Pressable
                    style={styles.btn}
                    disabled={busy || !declineReason.trim()}
                    onPress={() => {
                      act(order.id, "/returns/decline", { reason: declineReason.trim() });
                      setDeclineFor(null);
                    }}
                  >
                    <Text style={styles.btnText}>Send decline</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  intro: { fontSize: 14, color: theme.colors.text, marginBottom: 16, lineHeight: 20 },
  empty: { fontSize: 15, color: "#888" },
  error: { color: "#b91c1c", marginBottom: 12 },
  card: { borderWidth: 1, borderColor: "#e5e5e5", borderRadius: 10, padding: 14, marginBottom: 14 },
  buyer: { fontSize: 16, fontWeight: "700" },
  meta: { fontSize: 13, color: "#555", marginTop: 4 },
  total: { fontSize: 16, fontWeight: "700", marginTop: 8 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  thumb: { width: 36, height: 36, borderRadius: 6 },
  itemTitle: { flex: 1, fontSize: 13 },
  actions: { marginTop: 12, gap: 8 },
  btn: {
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "600" },
  btnOutline: {
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  btnOutlineText: { color: theme.colors.primary, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 10,
    minHeight: 70,
    marginBottom: 8,
    textAlignVertical: "top",
  },
});
