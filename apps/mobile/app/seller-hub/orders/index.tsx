import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  Image,
  ScrollView,
  Linking,
  Alert,
  Modal,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, getToken, apiPatch, apiPost } from "@/lib/api";
import { getOrderStatusLabel } from "@/lib/order-status";
import { formatShippingAddress } from "@/lib/format-address";
import { buildHubWebUrl } from "@/lib/seller-hub-web-url";
import { FulfillmentTabBar } from "@/components/fulfillment/FulfillmentTabBar";
import {
  type FulfillmentTabKey,
  isOrderEligibleForToShipQueue,
  filterOrdersForPickupTab,
  filterOrdersForDeliveryTab,
  formatSellerOrderTotal,
} from "@/lib/store-order-fulfillment";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

type HistorySubTab = "shipped" | "canceled";

interface OrderItemType {
  id: string;
  quantity: number;
  fulfillmentType?: string | null;
  pickupDetails?: Record<string, unknown> | null;
  storeItem: { id?: string; title: string; slug?: string; photos?: string[] };
}

interface LocalDeliveryDetails {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  deliveryAddress?: { street?: string; city?: string; state?: string; zip?: string };
  availableDropOffTimes?: string;
  note?: string;
}

interface StoreOrder {
  id: string;
  status: string;
  totalCents: number;
  createdAt: string;
  orderNumber?: string;
  orderKind?: string;
  shippingAddress?: unknown;
  shipment?: { id?: string } | null;
  shippedWithOrderId?: string | null;
  stripePaymentIntentId?: string | null;
  pickupSellerConfirmedAt?: string | null;
  pickupBuyerConfirmedAt?: string | null;
  localDeliveryDetails?: LocalDeliveryDetails | null;
  deliveryConfirmedAt?: string | null;
  deliveryBuyerConfirmedAt?: string | null;
  buyer?: { firstName: string; lastName: string; email?: string };
  items?: OrderItemType[];
}

function parseTabParam(value: string | undefined): FulfillmentTabKey {
  if (value === "pickups" || value === "deliveries" || value === "history" || value === "ship") {
    return value;
  }
  return "ship";
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[c & 63] : "=";
  }
  return out;
}

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString();
  } catch {
    return s;
  }
}

function canSellerCancelDeliveryFromMenu(o: StoreOrder): boolean {
  if (o.status !== "paid") return false;
  if (o.deliveryConfirmedAt) return false;
  if (o.localDeliveryDetails == null) return false;
  return (o.items ?? []).some((i) => (i.fulfillmentType ?? "") === "local_delivery");
}

function sellerCanMarkLocalDelivery(o: StoreOrder): boolean {
  if (o.deliveryConfirmedAt) return false;
  return ["paid", "shipped", "delivered"].includes(o.status);
}

function formatDeliveryAddr(d: LocalDeliveryDetails | null | undefined): string {
  if (!d?.deliveryAddress) return "—";
  const a = d.deliveryAddress;
  return [a.street, a.city, a.state, a.zip].filter(Boolean).join(", ") || "—";
}

function ToShipFlowView({
  orders,
  onRefresh,
  refreshing,
}: {
  orders: StoreOrder[];
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const router = useRouter();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingPackingSlip, setSavingPackingSlip] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(() => new Set());
  const [markingShippedId, setMarkingShippedId] = useState<string | null>(null);

  const selectedCount = selectedOrderIds.size;
  const selectedIdList = useMemo(() => Array.from(selectedOrderIds), [selectedOrderIds]);

  const loadStatus = useCallback(() => {
    apiGet<{ connected?: boolean }>("/api/shipping/status")
      .then((d) => setConnected(d.connected ?? false))
      .catch(() => setConnected(false));
  }, []);

  useFocusEffect(useCallback(() => { loadStatus(); }, [loadStatus]));

  function toggleOrderSelection(orderId: string) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function selectAllToShip() {
    setSelectedOrderIds(new Set(orders.map((o) => o.id)));
  }

  const openPurchaseLabelsWeb = () => {
    if (!connected) {
      Alert.alert(
        "Connect Shippo first",
        "Purchase labels in the app requires a connected Shippo account. You can still mark orders shipped below if you used another carrier."
      );
      return;
    }
    if (selectedIdList.length === 0) {
      Alert.alert("Select orders", "Choose at least one order to buy labels for.");
      return;
    }
    const hubUrl = buildHubWebUrl(siteBase, "/seller-hub/orders/shippo-bulk", {
      nwAppChrome: true,
      returnTo: "/seller-hub/orders",
      bulkOrderIds: selectedIdList,
    });
    const url = `/web?url=${encodeURIComponent(hubUrl)}&title=${encodeURIComponent("Shipping Labels")}`;
    (router.push as (href: string) => void)(url);
  };

  const handleSavePackingSlips = async () => {
    if (!connected) {
      Alert.alert("Connect Shippo", "Packing slips from this screen need a connected Shippo account.");
      return;
    }
    const selectedOrders = orders.filter((o) => selectedOrderIds.has(o.id));
    if (selectedOrders.length === 0) {
      Alert.alert("Select orders", "Choose at least one order for packing slips.");
      return;
    }
    setSavingPackingSlip(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        Alert.alert("Sign in required", "Please sign in to save packing slips.");
        return;
      }
      const sameBuyer =
        selectedOrders.length <= 1 ||
        selectedOrders.every(
          (o) => (o.buyer?.email ?? "").trim().toLowerCase() ===
            (selectedOrders[0].buyer?.email ?? "").trim().toLowerCase()
        );
      const orderIds = selectedOrders.map((o) => o.id);
      const url = `${API_BASE}/api/seller-hub/packing-slip`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderIds, combined: selectedOrders.length > 1 && sameBuyer }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
      }
      const arrayBuffer = await res.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const base64 = uint8ArrayToBase64(bytes);
      const cacheDir = FileSystem.cacheDirectory;
      if (!cacheDir) throw new Error("File system not available.");
      const fileUri = `${cacheDir}packing-slips.pdf`;
      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: "base64" });
      const shareable = await Sharing.isAvailableAsync();
      if (shareable) {
        await Sharing.shareAsync(fileUri, { mimeType: "application/pdf", dialogTitle: "Save packing slips" });
      } else {
        await Linking.openURL(fileUri);
      }
    } catch (e: unknown) {
      setError((e as Error).message ?? "Failed to save packing slips");
    } finally {
      setSavingPackingSlip(false);
    }
  };

  const confirmMarkShipped = (orderId: string) => {
    Alert.alert(
      "Mark as shipped?",
      "Use this if you already shipped without buying a label in the app. Reminders and badges update once marked.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark shipped",
          onPress: async () => {
            setMarkingShippedId(orderId);
            setError(null);
            try {
              await apiPatch(`/api/store-orders/${encodeURIComponent(orderId)}`, { status: "shipped" });
              onRefresh();
            } catch (e: unknown) {
              const msg =
                typeof e === "object" && e !== null && "error" in e && typeof (e as { error?: string }).error === "string"
                  ? (e as { error: string }).error
                  : "Could not mark shipped. Try again.";
              setError(msg);
              Alert.alert("Mark shipped", msg);
            } finally {
              setMarkingShippedId(null);
            }
          },
        },
      ]
    );
  };

  if (connected === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }
  if (orders.length === 0) {
    return (
      <View style={[styles.container, styles.shipContent]}>
        <Text style={styles.shipTitle}>Ship Items</Text>
        <Text style={styles.shipHint}>
          {connected
            ? "No orders need shipping. Labels are charged to your connected Shippo account."
            : "No orders are waiting to ship. Connect Shippo when you want to buy labels in the browser, or mark shipped from an order when you use your own postage."}
        </Text>
        <Text style={styles.shipEmpty}>No orders to ship</Text>
        {!connected ? (
          <Pressable
            style={({ pressed }) => [styles.shipBtn, { marginTop: 16 }, pressed && { opacity: 0.8 }]}
            onPress={() => (router.push as (href: string) => void)("/seller-hub/shipping-setup")}
          >
            <Text style={styles.shipBtnText}>Set up shipping (Shippo)</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.shipContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.shipTitle}>Ship Items</Text>
      <Text style={styles.shipHint}>
        {connected
          ? "Select orders for this run, then purchase labels (full-screen Shippo in the browser). Same-buyer orders are combined into one purchase per buyer."
          : "Mark shipped if you used your own carrier — that clears app reminders without buying a label here. Connect Shippo below when you want in-browser labels and packing slips."}
      </Text>
      {connected ? (
        <>
          <Pressable onPress={selectAllToShip} style={({ pressed }) => [styles.selectAllBtn, pressed && { opacity: 0.7 }]}>
            <Text style={styles.selectAllText}>Select all to ship</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.purchaseLabelsBtn,
              pressed && { opacity: 0.8 },
              selectedCount === 0 && styles.purchaseLabelsBtnDisabled,
            ]}
            onPress={openPurchaseLabelsWeb}
            disabled={selectedCount === 0}
          >
            <Ionicons name="pricetag-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.shipBtnText}>Purchase Labels</Text>
          </Pressable>
          <Text style={styles.packingSlipHint}>Packing slips use the same order selection.</Text>
          <Pressable
            style={({ pressed }) => [
              styles.packingSlipBtn,
              pressed && { opacity: 0.8 },
              selectedCount === 0 && styles.purchaseLabelsBtnDisabled,
            ]}
            onPress={handleSavePackingSlips}
            disabled={savingPackingSlip || selectedCount === 0}
          >
            {savingPackingSlip ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <View style={styles.packingSlipBtnInner}>
                <Ionicons name="print-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.shipBtnText}>Print / Save packing slips</Text>
              </View>
            )}
          </Pressable>
          <Text style={styles.shipNote}>
            {selectedCount} of {orders.length} selected for labels / packing slips
          </Text>
        </>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.shipBtnOutline, pressed && { opacity: 0.85 }]}
          onPress={() => (router.push as (href: string) => void)("/seller-hub/shipping-setup")}
        >
          <Text style={styles.shipBtnOutlineText}>Connect Shippo (optional)</Text>
        </Pressable>
      )}
      {error && (
        <View style={styles.shipErrBlock}>
          <Text style={styles.shipErr}>{error}</Text>
        </View>
      )}
      {orders.map((order) => {
        const orderNum = order.orderNumber ?? order.id.slice(-8).toUpperCase();
        const checked = selectedOrderIds.has(order.id);
        const addr = formatShippingAddress(order.shippingAddress);
        const showMarkShipped = isOrderEligibleForToShipQueue(order);
        return (
          <View key={order.id} style={styles.shipCard}>
            <View style={styles.shipRow}>
              {connected ? (
                <Pressable
                  onPress={() => toggleOrderSelection(order.id)}
                  style={({ pressed }) => [styles.shipCheckboxHit, pressed && { opacity: 0.7 }]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  accessibilityLabel={`Select order ${orderNum}`}
                >
                  <Ionicons
                    name={checked ? "checkbox" : "square-outline"}
                    size={26}
                    color={checked ? theme.colors.primary : "#888"}
                  />
                </Pressable>
              ) : (
                <View style={styles.shipCheckboxSpacer} />
              )}
              <View style={styles.shipRowBody}>
                <Pressable onPress={() => router.push(`/seller-hub/orders/${order.id}` as never)}>
                  <Text style={styles.shipOrderId}>
                    #{orderNum}
                    {order.orderKind === "reward_redemption" ? (
                      <Text style={styles.shipRewardBadge}> · Reward</Text>
                    ) : null}
                  </Text>
                </Pressable>
                <Text style={styles.shipBuyer}>
                  {order.buyer
                    ? [order.buyer.firstName, order.buyer.lastName].filter(Boolean).join(" ") || "—"
                    : "—"}
                </Text>
                <Text style={styles.shipAddr} numberOfLines={2}>
                  {addr || "—"}
                </Text>
                <Text style={styles.shipTotal}>{formatSellerOrderTotal(order)}</Text>
                {showMarkShipped ? (
                  <Pressable
                    style={({ pressed }) => [styles.markShippedBtn, pressed && { opacity: 0.85 }]}
                    onPress={() => confirmMarkShipped(order.id)}
                    disabled={markingShippedId === order.id}
                  >
                    {markingShippedId === order.id ? (
                      <ActivityIndicator color={theme.colors.primary} size="small" />
                    ) : (
                      <Text style={styles.markShippedBtnText}>Mark as shipped (no label)</Text>
                    )}
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

function PickupsTabView({
  orders,
  onRefresh,
  refreshing,
  onOrderUpdated,
}: {
  orders: StoreOrder[];
  onRefresh: () => void;
  refreshing: boolean;
  onOrderUpdated: (order: StoreOrder) => void;
}) {
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  const pickupOrders = useMemo(() => filterOrdersForPickupTab(orders), [orders]);
  const pending = pickupOrders.filter((o) => !o.pickupSellerConfirmedAt);
  const completed = pickupOrders.filter((o) => !!o.pickupSellerConfirmedAt);

  const markSellerPickedUp = async (orderId: string) => {
    setConfirmingId(orderId);
    try {
      await apiPatch(`/api/store-orders/${orderId}`, { pickupSellerConfirmed: true });
      const existing = pickupOrders.find((o) => o.id === orderId);
      if (existing) {
        onOrderUpdated({
          ...existing,
          pickupSellerConfirmedAt: new Date().toISOString(),
        });
      }
    } catch {
      // ignore
    } finally {
      setConfirmingId(null);
    }
  };

  if (pickupOrders.length === 0) {
    return (
      <View style={styles.emptyTab}>
        <Text style={styles.emptyText}>No pickup orders right now.</Text>
      </View>
    );
  }

  const renderOrderCard = (item: StoreOrder, showMarkBtn: boolean) => {
    const items = item.items ?? [];
    const pickupLine = items.find((i) => (i.fulfillmentType ?? "") === "pickup");
    const pd = (pickupLine?.pickupDetails ?? null) as Record<string, unknown> | null;
    const pickupName = pd
      ? [String(pd.firstName ?? "").trim(), String(pd.lastName ?? "").trim()].filter(Boolean).join(" ") || "—"
      : "—";
    const pickupWhen = [pd?.preferredPickupDate, pd?.preferredPickupTime].filter(Boolean).join(" · ");
    const sellerDone = !!item.pickupSellerConfirmedAt;
    const buyerDone = !!item.pickupBuyerConfirmedAt;
    const orderNum = item.orderNumber ?? item.id.slice(-8).toUpperCase();

    return (
      <View style={styles.card}>
        <Pressable
          onPress={() => router.push(`/seller-hub/orders/${item.id}` as never)}
          style={({ pressed }) => [styles.cardRow, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.orderId}>#{orderNum}</Text>
          <Text style={styles.status}>{getOrderStatusLabel(item.status)}</Text>
        </Pressable>
        <Text style={styles.buyer}>
          {item.buyer ? `${item.buyer.firstName} ${item.buyer.lastName}` : "—"}
        </Text>
        {pd?.phone ? <Text style={styles.pickupLine}>Phone: {String(pd.phone)}</Text> : null}
        {pd?.email ? <Text style={styles.pickupLine}>Email: {String(pd.email)}</Text> : null}
        {pickupWhen ? <Text style={styles.pickupLine}>Pickup: {pickupWhen}</Text> : null}
        {pd?.note ? <Text style={styles.pickupNote}>Note: {String(pd.note)}</Text> : null}
        <Text style={styles.pickupLine}>Pickup contact (form): {pickupName}</Text>
        <Text style={styles.confirmRow}>
          Seller: {sellerDone ? "Picked up" : "Pending"} · Buyer: {buyerDone ? "Confirmed" : "Pending"}
        </Text>
        <Text style={styles.date}>{formatDate(item.createdAt)}</Text>
        <Text style={styles.total}>{formatSellerOrderTotal(item)}</Text>
        {items.length > 0 && (
          <View style={styles.itemsRow}>
            {items.map((oi) => {
              const photoUrl = resolvePhotoUrl(oi.storeItem?.photos?.[0]);
              return (
                <View key={oi.id} style={styles.itemChip}>
                  {photoUrl ? (
                    <Image source={{ uri: photoUrl }} style={styles.itemThumb} />
                  ) : (
                    <View style={[styles.itemThumb, styles.itemThumbPlaceholder]} />
                  )}
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {oi.storeItem?.title ?? "Item"} × {oi.quantity}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
        {showMarkBtn && item.status === "paid" && !sellerDone && (
          <Pressable
            style={({ pressed }) => [styles.markBtn, pressed && { opacity: 0.85 }]}
            onPress={() => markSellerPickedUp(item.id)}
            disabled={confirmingId === item.id}
          >
            {confirmingId === item.id ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.markBtnText}>Mark picked up (seller)</Text>
            )}
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.tabContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.tabIntro}>
        Orders with in-store or local pickup will appear here. Mark them as picked up when the buyer collects the item.
      </Text>
      {pending.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Pending pickup</Text>
          {pending.map((item) => (
            <View key={item.id}>{renderOrderCard(item, true)}</View>
          ))}
        </>
      ) : (
        <Text style={styles.emptyInline}>No pending pickups.</Text>
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
            completed.map((item) => (
              <View key={item.id}>{renderOrderCard(item, false)}</View>
            ))}
        </>
      )}
    </ScrollView>
  );
}

function DeliveriesTabView({
  orders,
  onRefresh,
  refreshing,
  onOrderUpdated,
  onOrderRemoved,
}: {
  orders: StoreOrder[];
  onRefresh: () => void;
  refreshing: boolean;
  onOrderUpdated: (order: StoreOrder) => void;
  onOrderRemoved: (orderId: string) => void;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [deliveryMenuOrderId, setDeliveryMenuOrderId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const deliveryOrders = useMemo(() => filterOrdersForDeliveryTab(orders), [orders]);
  const pending = deliveryOrders.filter((o) => !(o.deliveryConfirmedAt && o.deliveryBuyerConfirmedAt));
  const completed = deliveryOrders.filter((o) => o.deliveryConfirmedAt && o.deliveryBuyerConfirmedAt);

  const markDelivered = async (orderId: string) => {
    setConfirmingId(orderId);
    try {
      await apiPatch(`/api/store-orders/${encodeURIComponent(orderId)}`, { deliveryConfirmed: true });
      const existing = deliveryOrders.find((o) => o.id === orderId);
      if (existing) {
        onOrderUpdated({
          ...existing,
          deliveryConfirmedAt: new Date().toISOString(),
        });
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
    const o = deliveryOrders.find((x) => x.id === orderId);
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
              onOrderRemoved(orderId);
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

  if (deliveryOrders.length === 0) {
    return (
      <View style={styles.emptyTab}>
        <Text style={styles.emptyText}>No orders with local delivery.</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.tabContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.tabIntro}>
          Local delivery orders. Mark as delivered when you have completed the delivery.
        </Text>
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
                      <Text style={styles.orderIdPrimary}>#{o.orderNumber ?? o.id.slice(-6)}</Text>
                      <Text style={styles.date}>{formatDate(o.createdAt)}</Text>
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
                  <Text style={styles.value}>{formatDeliveryAddr(o.localDeliveryDetails)}</Text>
                  {d.phone ? (
                    <>
                      <Text style={styles.label}>Phone</Text>
                      <Text style={styles.value}>{d.phone}</Text>
                    </>
                  ) : null}
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
                  <View style={styles.deliveryItemsRow}>
                    {(o.items ?? []).map((i, idx) => {
                      const photoUrl = resolvePhotoUrl(i.storeItem?.photos?.[0]);
                      return (
                        <View key={i.id ?? `item-${idx}`} style={styles.deliveryItemRow}>
                          {photoUrl ? (
                            <Image source={{ uri: photoUrl }} style={styles.deliveryItemThumb} />
                          ) : (
                            <View style={[styles.deliveryItemThumb, styles.itemThumbPlaceholder]} />
                          )}
                          <Text style={styles.deliveryItemText}>
                            {i.storeItem?.title} × {i.quantity}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                  {!o.deliveryConfirmedAt && sellerCanMarkLocalDelivery(o) ? (
                    <Pressable
                      style={({ pressed }) => [styles.markBtn, pressed && { opacity: 0.8 }]}
                      onPress={() => markDelivered(o.id)}
                      disabled={confirmingId === o.id}
                    >
                      {confirmingId === o.id ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.markBtnText}>Mark delivered (seller)</Text>
                      )}
                    </Pressable>
                  ) : !o.deliveryConfirmedAt ? (
                    <Text style={styles.cannotMarkYet}>
                      {o.status === "pending"
                        ? "This order is not paid yet. After the buyer pays (online or cash), you can mark it delivered here."
                        : "This order can't be marked delivered in its current state."}
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
                    <Text style={styles.orderIdPrimary}>#{o.orderNumber ?? o.id.slice(-6)}</Text>
                    <Text style={styles.date}>{formatDate(o.createdAt)}</Text>
                    <Text style={styles.value}>{name}</Text>
                    <Text style={styles.delivered}>
                      Delivered {o.deliveryConfirmedAt && formatDate(o.deliveryConfirmedAt)}
                    </Text>
                  </View>
                );
              })}
          </>
        )}
      </ScrollView>
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
    </>
  );
}

function HistoryTabView({
  shippedOrders,
  canceledOrders,
  onRefresh,
  refreshing,
}: {
  shippedOrders: StoreOrder[];
  canceledOrders: StoreOrder[];
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const router = useRouter();
  const [subTab, setSubTab] = useState<HistorySubTab>("shipped");
  const orders = subTab === "shipped" ? shippedOrders : canceledOrders;

  return (
    <View style={styles.container}>
      <View style={styles.historySubTabRow}>
        {(["shipped", "canceled"] as const).map((key) => {
          const count = key === "shipped" ? shippedOrders.length : canceledOrders.length;
          const active = subTab === key;
          return (
            <Pressable
              key={key}
              style={[styles.historySubTab, active && styles.historySubTabActive]}
              onPress={() => setSubTab(key)}
            >
              <Text style={[styles.historySubTabText, active && styles.historySubTabTextActive]}>
                {key === "shipped" ? "Shipped" : "Canceled"} ({count})
              </Text>
            </Pressable>
          );
        })}
      </View>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {subTab === "shipped" ? "No shipped orders." : "No canceled orders."}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const firstItem = item.items?.[0]?.storeItem;
          const photoUrl = firstItem?.photos?.[0] ? resolvePhotoUrl(firstItem.photos[0]) : undefined;
          const orderNum = item.orderNumber ?? item.id.slice(-8).toUpperCase();
          return (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
              onPress={() => router.push(`/seller-hub/orders/${item.id}` as never)}
            >
              <View style={styles.cardInner}>
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={styles.cardThumb} />
                ) : (
                  <View style={[styles.cardThumb, styles.cardThumbPlaceholder]} />
                )}
                <View style={styles.cardBody}>
                  <View style={styles.cardRow}>
                    <Text style={styles.orderId}>#{orderNum}</Text>
                    <Text style={styles.status}>{getOrderStatusLabel(item.status)}</Text>
                  </View>
                  <Text style={styles.buyer}>
                    {item.buyer ? `${item.buyer.firstName} ${item.buyer.lastName}` : "—"}
                  </Text>
                  <Text style={styles.date}>{formatDate(item.createdAt)}</Text>
                  <Text style={styles.total}>{formatSellerOrderTotal(item)}</Text>
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

export default function OrdersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const rawTab = params.tab;
  const tabParam = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const tab = parseTabParam(tabParam);

  const [shipOrders, setShipOrders] = useState<StoreOrder[]>([]);
  const [allOrders, setAllOrders] = useState<StoreOrder[]>([]);
  const [shippedOrders, setShippedOrders] = useState<StoreOrder[]>([]);
  const [canceledOrders, setCanceledOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const toShipOrders = useMemo(
    () => shipOrders.filter(isOrderEligibleForToShipQueue),
    [shipOrders]
  );

  const tabCounts = useMemo(
    () => ({
      ship: toShipOrders.length,
      pickups: filterOrdersForPickupTab(allOrders).filter((o) => !o.pickupSellerConfirmedAt).length,
      deliveries: filterOrdersForDeliveryTab(allOrders).filter(
        (o) => !(o.deliveryConfirmedAt && o.deliveryBuyerConfirmedAt)
      ).length,
    }),
    [toShipOrders.length, allOrders]
  );

  const setTab = useCallback(
    (next: FulfillmentTabKey) => {
      if (next === "ship") {
        router.replace("/seller-hub/orders");
      } else {
        router.replace(`/seller-hub/orders?tab=${next}`);
      }
    },
    [router]
  );

  const load = useCallback(() => {
    setLoading(true);
    const fetches: Promise<void>[] = [];

    if (tab === "ship") {
      fetches.push(
        apiGet<StoreOrder[] | { error: string }>("/api/store-orders?mine=1&needsShipment=1")
          .then((data) => setShipOrders(Array.isArray(data) ? data : []))
          .catch(() => setShipOrders([]))
      );
      fetches.push(
        apiGet<StoreOrder[]>("/api/store-orders?mine=1")
          .then((data) => {
            if (Array.isArray(data)) setAllOrders(data);
          })
          .catch(() => {})
      );
    }

    if (tab === "pickups" || tab === "deliveries") {
      fetches.push(
        apiGet<StoreOrder[] | { error: string }>("/api/store-orders?mine=1")
          .then((data) => setAllOrders(Array.isArray(data) ? data : []))
          .catch(() => setAllOrders([]))
      );
    }

    if (tab === "history") {
      fetches.push(
        Promise.all([
          apiGet<StoreOrder[]>("/api/store-orders?mine=1&shipped=1"),
          apiGet<StoreOrder[]>("/api/store-orders?mine=1&canceled=1"),
        ])
          .then(([shipped, canceled]) => {
            setShippedOrders(Array.isArray(shipped) ? shipped : []);
            setCanceledOrders(Array.isArray(canceled) ? canceled : []);
          })
          .catch(() => {
            setShippedOrders([]);
            setCanceledOrders([]);
          })
      );
    }

    Promise.all(fetches).finally(() => {
      setLoading(false);
      setRefreshing(false);
    });
  }, [tab]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    load();
  }, [tab]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const handleOrderUpdated = useCallback((updated: StoreOrder) => {
    setAllOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
  }, []);

  const handleOrderRemoved = useCallback((orderId: string) => {
    setAllOrders((prev) => prev.filter((o) => o.id !== orderId));
  }, []);

  const showInitialLoader =
    loading &&
    ((tab === "ship" && shipOrders.length === 0) ||
      ((tab === "pickups" || tab === "deliveries") && allOrders.length === 0) ||
      (tab === "history" && shippedOrders.length === 0 && canceledOrders.length === 0));

  if (showInitialLoader) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FulfillmentTabBar activeTab={tab} onTabChange={setTab} counts={tabCounts} />
      {tab === "ship" ? (
        <ToShipFlowView orders={toShipOrders} onRefresh={handleRefresh} refreshing={refreshing} />
      ) : tab === "pickups" ? (
        <PickupsTabView
          orders={allOrders}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          onOrderUpdated={handleOrderUpdated}
        />
      ) : tab === "deliveries" ? (
        <DeliveriesTabView
          orders={allOrders}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          onOrderUpdated={handleOrderUpdated}
          onOrderRemoved={handleOrderRemoved}
        />
      ) : (
        <HistoryTabView
          shippedOrders={shippedOrders}
          canceledOrders={canceledOrders}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  tabContent: { padding: 16, paddingBottom: 40 },
  tabIntro: { fontSize: 14, color: theme.colors.text, marginBottom: 16 },
  emptyTab: { flex: 1, padding: 32, alignItems: "center", justifyContent: "center" },
  emptyInline: { fontSize: 14, color: "#888", marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "600", marginBottom: 12, color: "#333" },
  list: { padding: 16, paddingBottom: 40 },
  empty: { padding: 32, alignItems: "center" },
  emptyText: { fontSize: 15, color: "#888" },
  card: {
    padding: 16,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    marginBottom: 12,
  },
  cardInner: { flexDirection: "row", alignItems: "flex-start" },
  cardThumb: { width: 56, height: 56, borderRadius: 8, marginRight: 12 },
  cardThumbPlaceholder: { backgroundColor: "#ddd" },
  cardBody: { flex: 1, minWidth: 0 },
  cardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  orderId: { fontSize: 14, fontWeight: "600", color: "#333" },
  orderIdPrimary: { fontSize: 14, fontWeight: "600", color: theme.colors.primary, marginBottom: 4 },
  status: { fontSize: 12, color: "#666", textTransform: "capitalize" },
  buyer: { fontSize: 14, color: "#444", marginTop: 8 },
  date: { fontSize: 12, color: "#888", marginTop: 4 },
  total: { fontSize: 16, fontWeight: "600", color: theme.colors.primary, marginTop: 8 },
  pickupLine: { fontSize: 13, color: "#444", marginTop: 4 },
  pickupNote: { fontSize: 13, color: "#666", marginTop: 4, fontStyle: "italic" },
  confirmRow: { fontSize: 12, color: "#555", marginTop: 8 },
  markBtn: {
    marginTop: 12,
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  markBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  itemsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  itemChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%",
  },
  itemThumb: { width: 36, height: 36, borderRadius: 6 },
  itemThumbPlaceholder: { backgroundColor: "#ddd" },
  itemTitle: { flex: 1, minWidth: 0, fontSize: 12, color: "#555" },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 4,
  },
  cardHeaderTitles: { flex: 1, minWidth: 0 },
  cardMenuBtn: { padding: 4, marginTop: -4, marginRight: -4 },
  label: { fontSize: 12, color: "#888", marginTop: 8 },
  value: { fontSize: 14, color: "#333" },
  delivered: { fontSize: 12, color: "#2e7d32", marginTop: 8 },
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
  completedCard: { backgroundColor: "#f0f0f0" },
  deliveryItemsRow: { marginTop: 4 },
  deliveryItemRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  deliveryItemThumb: { width: 32, height: 32, borderRadius: 6 },
  deliveryItemText: { fontSize: 14, color: "#333", flex: 1 },
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
  historySubTabRow: {
    flexDirection: "row",
    margin: 16,
    marginBottom: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
    padding: 2,
  },
  historySubTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 6,
  },
  historySubTabActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  historySubTabText: { fontSize: 13, fontWeight: "500", color: "#666" },
  historySubTabTextActive: { color: theme.colors.primary, fontWeight: "600" },
  shipContent: { padding: 20, paddingBottom: 40 },
  shipTitle: { fontSize: 20, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  shipHint: { fontSize: 14, color: "#666", marginBottom: 24 },
  shipEmpty: { fontSize: 16, color: "#888", marginTop: 16 },
  shipBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  shipBtnText: { color: "#fff", fontWeight: "600" },
  packingSlipBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 16,
  },
  packingSlipBtnInner: { flexDirection: "row", alignItems: "center" },
  packingSlipHint: { fontSize: 13, color: "#666", marginBottom: 10 },
  shipErr: { color: "#c62828", fontSize: 14 },
  shipErrBlock: { marginBottom: 16 },
  shipCard: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  shipRow: { flexDirection: "row", alignItems: "flex-start" },
  shipCheckboxHit: { paddingRight: 12, paddingTop: 2 },
  shipRowBody: { flex: 1, minWidth: 0 },
  shipOrderId: { fontSize: 15, fontWeight: "700", color: theme.colors.primary },
  shipRewardBadge: { fontSize: 12, fontWeight: "600", color: "#b45309" },
  shipBuyer: { fontSize: 15, fontWeight: "600", marginTop: 4, color: "#333" },
  shipAddr: { fontSize: 13, color: "#666", marginTop: 4, lineHeight: 18 },
  shipTotal: { fontSize: 15, fontWeight: "600", color: theme.colors.primary, marginTop: 6 },
  selectAllBtn: { alignSelf: "flex-start", marginBottom: 12 },
  selectAllText: { fontSize: 15, fontWeight: "600", color: theme.colors.primary },
  shipNote: {
    fontSize: 12,
    color: "#666",
    marginBottom: 12,
    lineHeight: 18,
  },
  purchaseLabelsBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 16,
  },
  purchaseLabelsBtnDisabled: {
    opacity: 0.45,
  },
  shipCheckboxSpacer: { width: 38 },
  shipBtnOutline: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 20,
  },
  shipBtnOutlineText: { color: theme.colors.primary, fontWeight: "600" },
  markShippedBtn: {
    marginTop: 10,
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
    minHeight: 40,
    justifyContent: "center",
  },
  markShippedBtnText: { fontSize: 14, fontWeight: "600", color: theme.colors.primary },
});
