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
  Modal,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";
import {
  storeReturnSellerMoneyAction,
  storeReturnSellerMoneyActionLabel,
} from "@/lib/store-return-seller-action";
import { returnLabelIsDue, sellerMustChooseReturnRefundTiming } from "@/lib/return-refund-timing";

interface OrderItem {
  id: string;
  quantity: number;
  fulfillmentType?: string | null;
  variant?: unknown;
  stockReturnDecision?: string | null;
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
  cancelReason?: string | null;
  inventoryRestoredAt?: string | null;
  createdAt: string;
  localDeliveryDetails?: unknown;
  buyer: { firstName: string; lastName: string; email: string };
  items: OrderItem[];
  storeReturn?: StoreReturn | null;
  returnShipment?: { labelUrl?: string | null; labelCostCents?: number } | null;
}

const SOLD_BEFORE_CHECKOUT_REASON = "Item sold before checkout was complete";

function isCanceledOrder(order: StoreOrder): boolean {
  if (order.storeReturn) return false;
  if (order.cancelReason === SOLD_BEFORE_CHECKOUT_REASON) return false;
  return order.status === "canceled" || order.status === "cancelled" || order.status === "refunded";
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatVariantLabel(variant: unknown): string | null {
  if (variant == null || typeof variant !== "object" || Array.isArray(variant)) return null;
  const parts = Object.entries(variant as Record<string, unknown>)
    .filter(([, value]) => value != null && String(value).trim() !== "")
    .map(([key, value]) => `${key.trim()}: ${String(value).trim()}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function stockChoiceLabel(item: OrderItem): string {
  const variant = formatVariantLabel(item.variant);
  const name = variant ? `${item.storeItem.title} — ${variant}` : item.storeItem.title;
  return `Return Stock Count for ${name}?`;
}

function stockChoiceResult(order: StoreOrder, item: OrderItem): string | null {
  if (item.stockReturnDecision === "returned" || (order.inventoryRestoredAt && !item.stockReturnDecision)) {
    return "Stock returned";
  }
  if (item.stockReturnDecision === "withheld") return "Stock not returned";
  return null;
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
  const [choiceBusy, setChoiceBusy] = useState(false);
  const [choiceError, setChoiceError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      apiGet<StoreOrder[]>("/api/store-orders?mine=1&returns=1").catch(() => [] as StoreOrder[]),
      apiGet<StoreOrder[]>("/api/store-orders?mine=1&canceled=1").catch(() => [] as StoreOrder[]),
    ])
      .then(([returns, canceled]) => {
        const openReturns = Array.isArray(returns) ? returns : [];
        const seen = new Set(openReturns.map((order) => order.id));
        const canceledOrders = (Array.isArray(canceled) ? canceled : []).filter(
          (order) => !seen.has(order.id) && isCanceledOrder(order)
        );
        setOrders([...openReturns, ...canceledOrders]);
      })
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

  const openReturnLabel = (orderId: string) => {
    router.push(`/seller-hub/shippo-order/${orderId}?mode=return` as never);
  };

  const choiceOrder = orders.find((order) => sellerMustChooseReturnRefundTiming(order)) ?? null;

  const chooseRefundTiming = async (timing: "now" | "on_arrival") => {
    if (!choiceOrder || choiceBusy) return;
    setChoiceBusy(true);
    setChoiceError(null);
    try {
      if (timing === "now") {
        await apiPost(`/api/store-orders/${choiceOrder.id}/returns/receive`, {});
      } else {
        await apiPost(`/api/store-orders/${choiceOrder.id}/returns/refund-timing`, { timing: "on_arrival" });
      }
      load();
    } catch (e) {
      setChoiceError(e instanceof Error ? e.message : "Could not save that choice.");
    } finally {
      setChoiceBusy(false);
    }
  };

  const act = async (orderId: string, path: string, body?: object) => {
    setBusyId(orderId);
    setError(null);
    try {
      await apiPost(`/api/store-orders/${orderId}${path}`, body ?? {});
      const approved = orders.find((o) => o.id === orderId);
      const hasShip = approved?.items.some((i) => (i.fulfillmentType ?? "ship") === "ship");
      if (path === "/returns/approve" && hasShip && !approved?.returnShipment?.labelUrl) {
        load();
        openReturnLabel(orderId);
        return;
      }
      load();
    } catch (e: unknown) {
      setError((e as { error?: string }).error ?? "Action failed");
      load();
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
        Refund requests arrive here after an item ships. Approve or decline each one. Canceled orders
        are listed here too. Under those items, choose Return only when you have that variant back.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {orders.length === 0 ? (
        <Text style={styles.empty}>No refunds yet.</Text>
      ) : (
        orders.map((order) => {
          const ret = order.storeReturn;
          const busy = busyId === order.id;
          const hasShip = order.items.some((i) => (i.fulfillmentType ?? "ship") === "ship");
          const moneyAction = storeReturnSellerMoneyAction({
            returnStatus: ret?.status,
            orderStatus: order.status,
          });
          const pendingRefund = ret?.status === "requested";
          return (
            <View key={order.id} style={styles.card}>
              <Text style={styles.buyer}>
                {order.buyer.firstName} {order.buyer.lastName}
              </Text>
              <Text style={styles.meta}>
                {ret
                  ? ret.status === "awaiting_return" && !order.returnShipment?.labelUrl
                    ? "Return approved. Send the buyer a return label."
                    : statusCopy(ret.status)
                  : "Canceled"}
              </Text>
              {ret?.reason ? <Text style={styles.meta}>Reason: {ret.reason}</Text> : null}
              {!ret && order.cancelReason ? (
                <Text style={styles.meta}>{order.cancelReason}</Text>
              ) : null}
              <Text style={styles.total}>{formatPrice(order.totalCents + (order.taxCents ?? 0))}</Text>
              {order.items.map((oi) => {
                const decided = stockChoiceResult(order, oi);
                return (
                  <View key={oi.id}>
                    <View style={styles.itemRow}>
                      {oi.storeItem.photos[0] ? (
                        <Image source={{ uri: oi.storeItem.photos[0] }} style={styles.thumb} />
                      ) : null}
                      <View style={styles.itemBody}>
                        <Text style={styles.itemTitle}>
                          {oi.storeItem.title} × {oi.quantity}
                        </Text>
                        {formatVariantLabel(oi.variant) ? (
                          <Text style={styles.variant}>{formatVariantLabel(oi.variant)}</Text>
                        ) : null}
                      </View>
                    </View>
                    {pendingRefund ? null : (
                      <View style={styles.stockSection}>
                        {decided ? (
                          <Text style={styles.stockResult}>{decided}</Text>
                        ) : (
                          <>
                            <Text style={styles.stockLabel}>{stockChoiceLabel(oi)}</Text>
                            <Text style={styles.stockNote}>
                              If you&apos;re waiting for this item to be returned, ignore this. You can return the stock later.
                            </Text>
                            <View style={styles.stockActions}>
                              <Pressable
                                style={styles.stockBtn}
                                disabled={busy}
                                onPress={() =>
                                  act(order.id, "/stock-return", {
                                    orderItemId: oi.id,
                                    decision: "return",
                                  })
                                }
                              >
                                <Text style={styles.stockBtnText}>Return</Text>
                              </Pressable>
                              <Pressable
                                style={styles.stockBtnOutline}
                                disabled={busy}
                                onPress={() =>
                                  act(order.id, "/stock-return", {
                                    orderItemId: oi.id,
                                    decision: "withhold",
                                  })
                                }
                              >
                                <Text style={styles.stockBtnOutlineText}>Don&apos;t Return</Text>
                              </Pressable>
                            </View>
                          </>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
              {pendingRefund ? (
                <View style={styles.stockSection}>
                  <Text style={styles.stockLabel}>Approve this refund request?</Text>
                  <View style={styles.stockActions}>
                    <Pressable
                      style={styles.stockBtn}
                      disabled={busy}
                      onPress={() => act(order.id, "/returns/approve")}
                    >
                      <Text style={styles.stockBtnText}>{busy ? "Working…" : "Approve"}</Text>
                    </Pressable>
                    <Pressable
                      style={styles.stockBtnOutline}
                      disabled={busy}
                      onPress={() => {
                        setDeclineFor(order.id);
                        setDeclineReason("");
                      }}
                    >
                      <Text style={styles.stockBtnOutlineText}>Decline</Text>
                    </Pressable>
                  </View>
                  <Pressable
                    style={[styles.btnOutline, { marginTop: 10 }]}
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
              {hasShip &&
              (ret?.status === "awaiting_return" || ret?.status === "in_transit") &&
              !order.returnShipment?.labelUrl ? (
                <View style={[styles.actions, styles.pairRow]}>
                  <View style={styles.pairCol}>
                  <Pressable
                    style={styles.btn}
                    onPress={() => {
                      const go = () =>
                        router.push(`/seller-hub/shippo-order/${order.id}?mode=return` as never);
                      if (!ret?.chargeReturnShipping) {
                        go();
                        return;
                      }
                      Alert.alert(
                        "Who pays for this label?",
                        "Choose before you buy it. If you deduct, the buyer is told the real Shippo price after the label is bought.",
                        [
                          { text: "Later", style: "cancel" },
                          {
                            text: "I'll pay",
                            onPress: () => {
                              void apiPost(`/api/store-orders/${order.id}/returns/label-payer`, { pay: "seller" })
                                .then(go)
                                .catch(() => Alert.alert("Could not save", "Try again before buying the label."));
                            },
                          },
                          {
                            text: "Deduct from refund",
                            onPress: () => {
                              void apiPost(`/api/store-orders/${order.id}/returns/label-payer`, { pay: "buyer" })
                                .then(go)
                                .catch(() => Alert.alert("Could not save", "Try again before buying the label."));
                            },
                          },
                        ]
                      );
                    }}
                  >
                    <Text style={styles.btnText}>Send Buyer Return Label</Text>
                  </Pressable>
                  {returnLabelIsDue(order) ? (
                    <View style={styles.dueTag}>
                      <Text style={styles.dueTagText}>Due</Text>
                    </View>
                  ) : null}
                  </View>
                  {moneyAction ? (
                    <View style={[styles.pairCol, styles.autoRefundBlock]}>
                      <Pressable
                        style={styles.btn}
                        disabled={busy}
                        onPress={() => act(order.id, "/returns/receive")}
                      >
                        <Text style={styles.btnText}>
                          {busy ? "Refunding…" : storeReturnSellerMoneyActionLabel(moneyAction)}
                        </Text>
                      </Pressable>
                      {moneyAction === "receive" ? (
                        <Text style={styles.autoRefundNote}>(Refunds Automatic at Delivery)</Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : moneyAction ? (
                <View style={[styles.actions, styles.autoRefundBlock]}>
                  <Pressable
                    style={styles.btn}
                    disabled={busy}
                    onPress={() => act(order.id, "/returns/receive")}
                  >
                    <Text style={styles.btnText}>
                      {busy ? "Refunding…" : storeReturnSellerMoneyActionLabel(moneyAction)}
                    </Text>
                  </Pressable>
                  {moneyAction === "receive" ? (
                    <Text style={styles.autoRefundNote}>(Refunds Automatic at Delivery)</Text>
                  ) : null}
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
      <Modal visible={choiceOrder != null} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>When should this refund go out?</Text>
            <Text style={styles.modalBody}>The return label was sent. Choose one to continue.</Text>
            {choiceError ? <Text style={styles.error}>{choiceError}</Text> : null}
            <Pressable
              style={styles.btn}
              disabled={choiceBusy}
              onPress={() => void chooseRefundTiming("now")}
            >
              <Text style={styles.btnText}>{choiceBusy ? "Working…" : "Refund Now"}</Text>
            </Pressable>
            <Pressable
              style={[styles.btnOutline, { marginTop: 10 }]}
              disabled={choiceBusy}
              onPress={() => void chooseRefundTiming("on_arrival")}
            >
              <Text style={styles.btnOutlineText}>Refund when item arrives</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 8 },
  thumb: { width: 36, height: 36, borderRadius: 6 },
  itemBody: { flex: 1 },
  itemTitle: { fontSize: 13 },
  variant: { fontSize: 12, color: "#555", marginTop: 2 },
  stockSection: {
    marginTop: 12,
    marginHorizontal: -14,
    paddingTop: 12,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
  },
  stockResult: { fontSize: 15, fontWeight: "700", color: theme.colors.earth },
  stockLabel: { fontSize: 15, fontWeight: "700", color: theme.colors.heading },
  stockNote: { marginTop: 6, fontSize: 13, lineHeight: 18, color: "#555" },
  stockActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  stockBtn: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  stockBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  stockBtnOutline: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  stockBtnOutlineText: { color: theme.colors.primary, fontSize: 15, fontWeight: "700" },
  actions: { marginTop: 12, gap: 8 },
  pairRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  pairCol: { flex: 1, gap: 8 },
  dueStack: { gap: 8 },
  dueTag: {
    backgroundColor: "#6b2430",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
  },
  dueTagText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  autoRefundBlock: { alignItems: "center" },
  autoRefundNote: { fontSize: 13, fontWeight: "700", color: "#6b2430", textAlign: "center" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: { backgroundColor: "#fff", borderRadius: 12, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: theme.colors.heading },
  modalBody: { marginTop: 8, marginBottom: 16, fontSize: 14, lineHeight: 20, color: "#444" },
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
