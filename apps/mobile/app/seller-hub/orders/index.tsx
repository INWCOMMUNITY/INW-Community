import React, { useState, useCallback, useEffect } from "react";
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
  TextInput,
  Linking,
  Alert,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, getToken } from "@/lib/api";
import { getOrderStatusLabel } from "@/lib/order-status";
import { formatShippingAddress } from "@/lib/format-address";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
const SHIPPO_ADD_ADDRESS_URL = "https://apps.goshippo.com/";

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
  shippingAddress?: unknown;
  buyer?: { firstName: string; lastName: string; email?: string };
  items?: { quantity: number; storeItem?: { title: string; slug: string; photos?: string[] } }[];
}

interface Rate {
  id: string;
  carrier: string;
  service: string;
  rateCents: number;
  shipmentId?: string;
}

const DEFAULT_WEIGHT = 16;
const DEFAULT_LENGTH = 12;
const DEFAULT_WIDTH = 9;
const DEFAULT_HEIGHT = 6;

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

const TABS: { key: OrderTab; label: string; param: string }[] = [
  { key: "to_ship", label: "To Ship", param: "mine=1&needsShipment=1" },
  { key: "shipped", label: "Shipped", param: "mine=1&shipped=1" },
  { key: "canceled", label: "Canceled", param: "mine=1&canceled=1" },
  { key: "all", label: "All", param: "mine=1" },
];

function groupKey(group: StoreOrder[]): string {
  return group.length === 1 ? group[0].id : group.map((o) => o.id).join("-");
}

function ToShipFlowView({
  orders,
  setOrders,
  onRefresh,
  refreshing,
}: {
  orders: StoreOrder[];
  setOrders: React.Dispatch<React.SetStateAction<StoreOrder[]>>;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const router = useRouter();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [combineByBuyer, setCombineByBuyer] = useState(false);
  const [dims, setDims] = useState<
    Record<string, { weightOz: number; lengthIn: number; widthIn: number; heightIn: number }>
  >({});
  const [rates, setRates] = useState<Record<string, { shipmentId: string; rates: Rate[]; loading?: boolean }>>({});
  const [selectedRate, setSelectedRate] = useState<Record<string, Rate>>({});
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingPackingSlip, setSavingPackingSlip] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const loadStatus = useCallback(() => {
    apiGet<{ connected?: boolean }>("/api/shipping/status")
      .then((d) => setConnected(d.connected ?? false))
      .catch(() => setConnected(false));
  }, []);

  useFocusEffect(useCallback(() => { loadStatus(); }, [loadStatus]));

  useEffect(() => {
    const next: Record<string, { weightOz: number; lengthIn: number; widthIn: number; heightIn: number }> = {};
    orders.forEach((o) => {
      next[o.id] = {
        weightOz: DEFAULT_WEIGHT,
        lengthIn: DEFAULT_LENGTH,
        widthIn: DEFAULT_WIDTH,
        heightIn: DEFAULT_HEIGHT,
      };
    });
    const byBuyer = new Map<string, StoreOrder[]>();
    orders.forEach((o) => {
      const key = o.buyer?.email ?? o.id;
      if (!byBuyer.has(key)) byBuyer.set(key, []);
      byBuyer.get(key)!.push(o);
    });
    byBuyer.forEach((group) => {
      if (group.length > 1) {
        const key = group.map((o) => o.id).join("-");
        next[key] = {
          weightOz: DEFAULT_WEIGHT * group.length,
          lengthIn: DEFAULT_LENGTH,
          widthIn: DEFAULT_WIDTH,
          heightIn: DEFAULT_HEIGHT,
        };
      }
    });
    setDims(next);
  }, [orders]);

  const orderGroups = combineByBuyer
    ? (() => {
        const byBuyer = new Map<string, StoreOrder[]>();
        orders.forEach((o) => {
          const key = o.buyer?.email ?? o.id;
          if (!byBuyer.has(key)) byBuyer.set(key, []);
          byBuyer.get(key)!.push(o);
        });
        return Array.from(byBuyer.values()).filter((g) => g.length > 0);
      })()
    : orders.map((o) => [o]);

  const updateDim = (
    key: string,
    field: "weightOz" | "lengthIn" | "widthIn" | "heightIn",
    val: string
  ) => {
    const n = parseFloat(val) || 0;
    setDims((prev) => {
      const base = prev[key] ?? {
        weightOz: DEFAULT_WEIGHT,
        lengthIn: DEFAULT_LENGTH,
        widthIn: DEFAULT_WIDTH,
        heightIn: DEFAULT_HEIGHT,
      };
      return { ...prev, [key]: { ...base, [field]: n } };
    });
  };

  const getRates = async (group: StoreOrder[]) => {
    const key = groupKey(group);
    const dim = dims[key] ?? {
      weightOz: DEFAULT_WEIGHT,
      lengthIn: DEFAULT_LENGTH,
      widthIn: DEFAULT_WIDTH,
      heightIn: DEFAULT_HEIGHT,
    };
    const orderIds = group.map((o) => o.id);
    setRates((prev) => ({ ...prev, [key]: { ...prev[key], loading: true, shipmentId: "", rates: [] } }));
    setError(null);
    try {
      const res = await apiPost<{ shipmentId: string; rates: Rate[] }>("/api/shipping/rates", {
        orderIds,
        weightOz: dim.weightOz,
        lengthIn: dim.lengthIn,
        widthIn: dim.widthIn,
        heightIn: dim.heightIn,
      });
      setRates((prev) => ({
        ...prev,
        [key]: { shipmentId: res.shipmentId, rates: res.rates ?? [], loading: false },
      }));
      const first = res.rates?.[0];
      if (first) setSelectedRate((prev) => ({ ...prev, [key]: first }));
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Failed to get rates");
      setRates((prev) => ({ ...prev, [key]: { shipmentId: "", rates: [], loading: false } }));
    }
  };

  const purchaseSingleLabel = async (group: StoreOrder[]) => {
    const key = groupKey(group);
    const rate = selectedRate[key];
    const rateData = rates[key];
    const dim = dims[key];
    if (!rate || !rateData?.shipmentId || !dim) return;
    setError(null);
    const res = await apiPost<{ shipment?: { labelUrl?: string } }>("/api/shipping/label", {
      orderIds: group.map((o) => o.id),
      shippoShipmentId: rate.shipmentId ?? rateData.shipmentId,
      rateId: rate.id,
      carrier: rate.carrier,
      service: rate.service,
      rateCents: rate.rateCents,
      weightOz: dim.weightOz,
      lengthIn: dim.lengthIn,
      widthIn: dim.widthIn,
      heightIn: dim.heightIn,
    });
    setOrders((prev) => prev.filter((o) => !group.some((g) => g.id === o.id)));
    setRates((prev) => { const next = { ...prev }; delete next[key]; return next; });
    setSelectedRate((prev) => { const next = { ...prev }; delete next[key]; return next; });
    setCollapsed((prev) => { const next = { ...prev }; delete next[key]; return next; });
    const url = res.shipment?.labelUrl;
    if (url) Linking.openURL(url).catch(() => {});
  };

  const purchaseAllLabels = async () => {
    const groupsToPurchase = orderGroups.filter((group) => {
      const key = groupKey(group);
      const rate = selectedRate[key];
      const rateData = rates[key];
      const dim = dims[key];
      return !!(rate && rateData?.shipmentId && dim);
    });
    if (groupsToPurchase.length === 0) return;
    setPurchasing("all");
    setError(null);
    try {
      for (const group of groupsToPurchase) {
        await purchaseSingleLabel(group);
      }
      if (groupsToPurchase.length > 0) {
        Alert.alert("Labels purchased", "Labels have been opened in your browser. You can print or save them from there.");
      }
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Failed to purchase label");
    } finally {
      setPurchasing(null);
    }
  };

  const selectRateAndCollapse = (key: string, r: Rate) => {
    setSelectedRate((prev) => ({ ...prev, [key]: r }));
    setCollapsed((prev) => ({ ...prev, [key]: true }));
  };

  const handleSavePackingSlips = async () => {
    if (orders.length === 0) return;
    setSavingPackingSlip(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        Alert.alert("Sign in required", "Please sign in to save packing slips.");
        return;
      }
      const orderIds = orders.map((o) => o.id);
      const url = `${API_BASE}/api/seller-hub/packing-slip`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderIds, combined: combineByBuyer }),
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

  if (connected === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }
  if (!connected) {
    return (
      <View style={styles.container}>
        <View style={styles.shipContent}>
          <Text style={styles.shipTitle}>Ship Items</Text>
          <Text style={styles.shipHint}>Connect your Shippo account to purchase shipping labels.</Text>
          <Pressable
            style={({ pressed }) => [styles.shipBtn, pressed && { opacity: 0.8 }]}
            onPress={() => (router.push as (href: string) => void)("/seller-hub/shipping-setup")}
          >
            <Text style={styles.shipBtnText}>Set up shipping</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  if (orders.length === 0) {
    return (
      <View style={[styles.container, styles.shipContent]}>
        <Text style={styles.shipTitle}>Ship Items</Text>
        <Text style={styles.shipHint}>No orders need shipping. Labels are charged to your Shippo account.</Text>
        <Text style={styles.shipEmpty}>No orders to ship</Text>
      </View>
    );
  }

  const canCombineOrders = orders.length >= 2 && new Set(orders.map((o) => o.buyer?.email)).size < orders.length;
  const groupsWithRate = orderGroups.filter(
    (g) => selectedRate[groupKey(g)] && rates[groupKey(g)]?.shipmentId && dims[groupKey(g)]
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.shipContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.shipTitle}>Ship Items</Text>
      <Text style={styles.shipHint}>
        Purchase shipping labels. Labels are charged to your connected Shippo account. Add a return address in Shippo to get rates.
      </Text>
      {canCombineOrders && (
        <Pressable
          style={({ pressed }) => [styles.shipToggle, pressed && { opacity: 0.8 }]}
          onPress={() => setCombineByBuyer((b) => !b)}
        >
          <Text style={styles.shipToggleText}>{combineByBuyer ? "✓ " : ""}Combine orders for same buyer</Text>
        </Pressable>
      )}
      <Pressable
        style={({ pressed }) => [styles.packingSlipBtn, pressed && { opacity: 0.8 }]}
        onPress={handleSavePackingSlips}
        disabled={savingPackingSlip}
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
      {error && (
        <View style={styles.shipErrBlock}>
          <Text style={styles.shipErr}>{error}</Text>
          {error.toLowerCase().includes("return address") && (
            <Pressable
              style={({ pressed }) => [styles.shippoLink, pressed && { opacity: 0.8 }]}
              onPress={() => Linking.openURL(SHIPPO_ADD_ADDRESS_URL).catch(() => {})}
            >
              <Text style={styles.shippoLinkText}>Add address in Shippo →</Text>
            </Pressable>
          )}
        </View>
      )}
      {orderGroups.map((group) => {
        const key = groupKey(group);
        const order = group[0];
        const dim = dims[key] ?? {
          weightOz: DEFAULT_WEIGHT,
          lengthIn: DEFAULT_LENGTH,
          widthIn: DEFAULT_WIDTH,
          heightIn: DEFAULT_HEIGHT,
        };
        const rateData = rates[key];
        const rate = selectedRate[key];
        const isCollapsed = collapsed[key] && rate;
        const addr = order.shippingAddress as Record<string, string> | null;
        const addrStr = formatShippingAddress(addr);

        return (
          <View key={key} style={styles.shipCard}>
            <Pressable
              onPress={() => isCollapsed && setCollapsed((prev) => ({ ...prev, [key]: false }))}
              style={styles.shipCardHeader}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.shipOrderId}>
                  {group.length === 1 ? `#${order.id.slice(-6)}` : `${group.length} orders (same buyer)`}
                </Text>
                <Text style={styles.shipBuyer}>
                  {order.buyer ? [order.buyer.firstName, order.buyer.lastName].filter(Boolean).join(" ") || "—" : "—"}
                </Text>
                {isCollapsed && rate && (
                  <Text style={styles.shipSelectedRate}>
                    {rate.carrier} {rate.service} — {formatPrice(rate.rateCents)}
                  </Text>
                )}
              </View>
              {isCollapsed && <Ionicons name="chevron-down" size={24} color={theme.colors.primary} />}
            </Pressable>
            {!isCollapsed && (
              <>
                <Text style={styles.shipAddr}>{addrStr || "—"}</Text>
                <Text style={styles.shipDimLabel}>Package dimensions</Text>
                <View style={styles.shipDimRow}>
                  <TextInput
                    style={[styles.shipDimInput, { marginRight: 4 }]}
                    placeholder="Weight (oz)"
                    placeholderTextColor={theme.colors.placeholder}
                    value={dim.weightOz ? String(dim.weightOz) : ""}
                    onChangeText={(v) => updateDim(key, "weightOz", v)}
                    keyboardType="numeric"
                  />
                  <TextInput
                    style={[styles.shipDimInput, { marginHorizontal: 4 }]}
                    placeholder="L"
                    placeholderTextColor={theme.colors.placeholder}
                    value={dim.lengthIn ? String(dim.lengthIn) : ""}
                    onChangeText={(v) => updateDim(key, "lengthIn", v)}
                    keyboardType="numeric"
                  />
                  <TextInput
                    style={[styles.shipDimInput, { marginHorizontal: 4 }]}
                    placeholder="W"
                    placeholderTextColor={theme.colors.placeholder}
                    value={dim.widthIn ? String(dim.widthIn) : ""}
                    onChangeText={(v) => updateDim(key, "widthIn", v)}
                    keyboardType="numeric"
                  />
                  <TextInput
                    style={[styles.shipDimInput, { marginLeft: 4 }]}
                    placeholder="H"
                    placeholderTextColor={theme.colors.placeholder}
                    value={dim.heightIn ? String(dim.heightIn) : ""}
                    onChangeText={(v) => updateDim(key, "heightIn", v)}
                    keyboardType="numeric"
                  />
                </View>
                <Pressable
                  style={({ pressed }) => [styles.shipRatesBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => getRates(group)}
                  disabled={rateData?.loading}
                >
                  {rateData?.loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.shipBtnText}>Get rates</Text>
                  )}
                </Pressable>
                {rateData?.rates && rateData.rates.length > 0 && (
                  <>
                    <Text style={styles.shipRateLabel}>Select rate</Text>
                    {rateData.rates.map((r) => (
                      <Pressable
                        key={r.id}
                        style={({ pressed }) => [
                          styles.shipRateOpt,
                          rate?.id === r.id && styles.shipRateOptSelected,
                          pressed && { opacity: 0.8 },
                        ]}
                        onPress={() => selectRateAndCollapse(key, r)}
                      >
                        <Text style={styles.shipRateText}>
                          {r.carrier} {r.service} — {formatPrice(r.rateCents)}
                        </Text>
                      </Pressable>
                    ))}
                  </>
                )}
              </>
            )}
          </View>
        );
      })}
      {groupsWithRate.length > 0 && (
        <View style={styles.purchaseSection}>
          <Text style={styles.shipNote}>
            All labels will be purchased from the payment option on file for your Shippo account.
          </Text>
          <Text style={styles.shipNote}>Labels open in your browser—use Print or Share to print.</Text>
          <Pressable
            style={({ pressed }) => [styles.purchaseLabelsBtn, pressed && { opacity: 0.8 }]}
            onPress={purchaseAllLabels}
            disabled={purchasing === "all"}
          >
            {purchasing === "all" ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.shipBtnText}>Purchase Labels ({groupsWithRate.length})</Text>
            )}
          </Pressable>
        </View>
      )}
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
        <ToShipFlowView orders={orders} setOrders={setOrders} onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing} />
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
  shipToggle: { marginBottom: 16 },
  shipToggleText: { fontSize: 14, color: theme.colors.primary, fontWeight: "600" },
  shipErr: { color: "#c62828", fontSize: 14 },
  shipErrBlock: { marginBottom: 16 },
  shippoLink: { marginTop: 8 },
  shippoLinkText: { fontSize: 14, color: theme.colors.primary, fontWeight: "600" },
  shipCard: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  shipCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  shipOrderId: { fontSize: 14, fontWeight: "600", color: theme.colors.primary },
  shipBuyer: { fontSize: 16, fontWeight: "600", marginTop: 4 },
  shipSelectedRate: { fontSize: 14, color: "#2e7d32", marginTop: 4, fontWeight: "500" },
  shipAddr: { fontSize: 14, color: "#666", marginTop: 4, marginBottom: 12 },
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
    borderRadius: 8,
    alignItems: "center",
  },
});
