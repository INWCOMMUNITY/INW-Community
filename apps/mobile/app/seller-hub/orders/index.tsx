import React, { useState, useCallback, useEffect, useMemo } from "react";
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
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, getToken, apiPatch } from "@/lib/api";
import { getOrderStatusLabel } from "@/lib/order-status";
import { formatShippingAddress } from "@/lib/format-address";
import { buildHubWebUrl } from "@/lib/seller-hub-web-url";
import { orderHasShippedLine } from "@/lib/shippo-order-label-eligibility";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

type OrderTab = "to_ship" | "shipped" | "canceled" | "all";

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
  buyer?: { firstName: string; lastName: string; email?: string };
  items?: {
    quantity: number;
    fulfillmentType?: string | null;
    storeItem?: { title: string; slug: string; photos?: string[] };
  }[];
}

function canMarkShippedWithoutLabel(o: StoreOrder): boolean {
  return (
    o.status === "paid" &&
    !o.shipment &&
    !o.shippedWithOrderId &&
    orderHasShippedLine(o.items)
  );
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

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(s: string): string {
  try {
    const d = new Date(s);
    return d.toLocaleDateString();
  } catch (_) {
    return s;
  }
}

function sellerOrderTotalLabel(order: StoreOrder): string {
  if (order.orderKind === "reward_redemption" && order.totalCents === 0) {
    return "No charge (reward)";
  }
  return formatPrice(order.totalCents);
}

const TABS: { key: OrderTab; label: string; param: string }[] = [
  { key: "to_ship", label: "To Ship", param: "mine=1&needsShipment=1" },
  { key: "shipped", label: "Shipped", param: "mine=1&shipped=1" },
  { key: "canceled", label: "Canceled", param: "mine=1&canceled=1" },
  { key: "all", label: "All", param: "mine=1" },
];

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

  useEffect(() => {
    setSelectedOrderIds(new Set(orders.map((o) => o.id)));
  }, [orders]);

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
    const url = `/web?url=${encodeURIComponent(hubUrl)}&title=${encodeURIComponent("Shipping labels")}`;
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
            <Text style={styles.shipBtnText}>Purchase labels</Text>
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
        const showMarkShipped = canMarkShippedWithoutLabel(order);
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
                <Text style={styles.shipTotal}>{sellerOrderTotalLabel(order)}</Text>
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

export default function OrdersScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<OrderTab>("to_ship");
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    const param = TABS.find((t) => t.key === tab)?.param ?? "mine=1";
    setLoading(true);
    apiGet<StoreOrder[] | { error: string }>(`/api/store-orders?${param}`)
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .catch(() => setOrders([]))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [tab]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading && orders.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === "to_ship" ? (
        <ToShipFlowView orders={orders} onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing} />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            !loading && orders.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  {tab === "shipped"
                    ? "No shipped orders."
                    : tab === "canceled"
                      ? "No canceled orders."
                      : "No orders yet."}
                </Text>
              </View>
            ) : null
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
                    <Text style={styles.total}>{formatPrice(item.totalCents)}</Text>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#fff",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.primary,
  },
  tabText: { fontSize: 13, color: "#666" },
  tabTextActive: { fontWeight: "600", color: theme.colors.primary },
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
  cardRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderId: { fontSize: 14, fontWeight: "600", color: "#333" },
  status: { fontSize: 12, color: "#666", textTransform: "capitalize" },
  buyer: { fontSize: 14, color: "#444", marginTop: 4 },
  date: { fontSize: 12, color: "#888", marginTop: 2 },
  total: { fontSize: 16, fontWeight: "600", color: theme.colors.primary, marginTop: 4 },
  // To-ship flow (ship UI)
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
  shipToggle: { marginBottom: 16 },
  shipToggleText: { fontSize: 14, color: theme.colors.primary, fontWeight: "600" },
  shipErr: { color: "#c62828", fontSize: 14 },
  shipErrBlock: { marginBottom: 16 },
  shippoLink: { marginTop: 8 },
  shippoLinkText: { fontSize: 14, color: theme.colors.primary, fontWeight: "600" },
  shipCard: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  shipRow: { flexDirection: "row", alignItems: "flex-start" },
  shipCheckboxHit: { paddingRight: 12, paddingTop: 2 },
  shipRowBody: { flex: 1, minWidth: 0 },
  shipCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  shipOrderId: { fontSize: 15, fontWeight: "700", color: theme.colors.primary },
  shipRewardBadge: { fontSize: 12, fontWeight: "600", color: "#b45309" },
  shipBuyer: { fontSize: 15, fontWeight: "600", marginTop: 4, color: "#333" },
  shipAddr: { fontSize: 13, color: "#666", marginTop: 4, lineHeight: 18 },
  shipTotal: { fontSize: 15, fontWeight: "600", color: theme.colors.primary, marginTop: 6 },
  selectAllBtn: { alignSelf: "flex-start", marginBottom: 12 },
  selectAllText: { fontSize: 15, fontWeight: "600", color: theme.colors.primary },
  shipSelectedRate: { fontSize: 14, color: "#2e7d32", marginTop: 4, fontWeight: "500" },
  shipDimLabel: { fontSize: 12, color: "#888", marginBottom: 8 },
  shipDimRow: { flexDirection: "row", marginBottom: 12 },
  shipDimInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
  },
  shipRatesBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  shipRateLabel: { fontSize: 14, fontWeight: "600", marginBottom: 8 },
  shipRateOpt: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    marginBottom: 8,
  },
  shipRateOptSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.creamAlt },
  shipRateText: { fontSize: 14, color: "#333" },
  purchaseSection: {
    marginTop: 24,
    paddingTop: 20,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
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
