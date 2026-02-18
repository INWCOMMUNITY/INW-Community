import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  RefreshControl,
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
import { formatShippingAddress } from "@/lib/format-address";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

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

interface OrderItem {
  id: string;
  quantity: number;
  storeItem: { title: string; slug: string };
}

interface StoreOrder {
  id: string;
  totalCents: number;
  shippingAddress: unknown;
  buyer: { firstName: string; lastName: string; email: string };
  items: OrderItem[];
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

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function ShipScreen() {
  const router = useRouter();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [combineByBuyer, setCombineByBuyer] = useState(false);

  const [dims, setDims] = useState<
    Record<string, { weightOz: number; lengthIn: number; widthIn: number; heightIn: number }>
  >({});
  const [rates, setRates] = useState<Record<string, { shipmentId: string; rates: Rate[]; loading?: boolean }>>({});
  const [selectedRate, setSelectedRate] = useState<Record<string, Rate>>({});
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingTrial, setAddingTrial] = useState(false);
  const [savingPackingSlip, setSavingPackingSlip] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const loadStatus = useCallback(() => {
    apiGet<{ connected?: boolean }>("/api/shipping/status")
      .then((d) => setConnected(d.connected ?? false))
      .catch(() => setConnected(false));
  }, []);

  const loadOrders = useCallback(() => {
    apiGet<StoreOrder[]>("/api/store-orders?mine=1&needsShipment=1")
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setOrders(arr);
        const next: Record<string, { weightOz: number; lengthIn: number; widthIn: number; heightIn: number }> = {};
        arr.forEach((o) => {
          next[o.id] = {
            weightOz: DEFAULT_WEIGHT,
            lengthIn: DEFAULT_LENGTH,
            widthIn: DEFAULT_WIDTH,
            heightIn: DEFAULT_HEIGHT,
          };
        });
        const byBuyer = new Map<string, StoreOrder[]>();
        arr.forEach((o) => {
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
      })
      .catch(() => setOrders([]))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStatus();
      loadOrders();
    }, [loadStatus, loadOrders])
  );

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

  const groupKey = (group: StoreOrder[]) =>
    group.length === 1 ? group[0].id : group.map((o) => o.id).join("-");

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
      return {
        ...prev,
        [key]: { ...base, [field]: n },
      };
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
      setRates((prev) => ({
        ...prev,
        [key]: { shipmentId: "", rates: [], loading: false },
      }));
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
      easypostShipmentId: rate.shipmentId ?? rateData.shipmentId,
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
    setRates((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setSelectedRate((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setCollapsed((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const url = res.shipment?.labelUrl;
    if (url) Linking.openURL(url).catch(() => {});
    return res;
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

  const addTrialOrder = async () => {
    setAddingTrial(true);
    setError(null);
    try {
      const order = await apiPost<StoreOrder>("/api/store-orders/trial");
      setOrders((prev) => [order, ...prev]);
      setDims((prev) => ({
        ...prev,
        [order.id]: {
          weightOz: DEFAULT_WEIGHT,
          lengthIn: DEFAULT_LENGTH,
          widthIn: DEFAULT_WIDTH,
          heightIn: DEFAULT_HEIGHT,
        },
      }));
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Failed to add trial order");
    } finally {
      setAddingTrial(false);
    }
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
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
      if (!cacheDir) {
        throw new Error("File system not available.");
      }
      const fileUri = `${cacheDir}packing-slips.pdf`;
      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: "base64" });
      const shareable = await Sharing.isAvailableAsync();
      if (shareable) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "application/pdf",
          dialogTitle: "Save packing slips",
        });
      } else {
        await Linking.openURL(fileUri);
      }
    } catch (e: unknown) {
      setError((e as Error).message ?? "Failed to save packing slips");
    } finally {
      setSavingPackingSlip(false);
    }
  };

  if (loading && orders.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!connected) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Ship Items</Text>
        <Text style={styles.hint}>
          Connect your EasyPost account to purchase shipping labels.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.8 }]}
          onPress={() => (router.push as (href: string) => void)("/seller-hub/shipping-setup")}
        >
          <Text style={styles.btnText}>Set up shipping</Text>
        </Pressable>
      </View>
    );
  }

  if (orders.length === 0) {
    return (
      <View style={[styles.container, styles.content]}>
        <Text style={styles.title}>Ship Items</Text>
        <Text style={styles.hint}>No orders need shipping. Labels are charged to your EasyPost account.</Text>
        <Text style={styles.empty}>No orders to ship</Text>
        <Pressable
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.8 }]}
          onPress={addTrialOrder}
          disabled={addingTrial}
        >
          {addingTrial ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.btnText}>Add trial order</Text>
          )}
        </Pressable>
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
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadOrders(); }} />
      }
    >
      <Text style={styles.title}>Ship Items</Text>
      <Text style={styles.hint}>
        Purchase shipping labels. Labels are charged to your connected EasyPost account.
      </Text>

      {canCombineOrders && (
        <Pressable
          style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.8 }]}
          onPress={() => setCombineByBuyer((b) => !b)}
        >
          <Text style={styles.toggleText}>
            {combineByBuyer ? "✓ " : ""}Combine orders for same buyer
          </Text>
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
            <Text style={styles.btnText}>Print / Save packing slips</Text>
          </View>
        )}
      </Pressable>

      {error && <Text style={styles.err}>{error}</Text>}

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
          <View key={key} style={styles.card}>
            <Pressable
              onPress={() => isCollapsed && setCollapsed((prev) => ({ ...prev, [key]: false }))}
              style={styles.cardHeader}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.orderId}>
                  {group.length === 1 ? `#${order.id.slice(-6)}` : `${group.length} orders (same buyer)`}
                </Text>
                <Text style={styles.buyer}>
                  {order.buyer ? [order.buyer.firstName, order.buyer.lastName].filter(Boolean).join(" ") || "—" : "—"}
                </Text>
                {isCollapsed && rate && (
                  <Text style={styles.selectedRate}>
                    {rate.carrier} {rate.service} — {formatPrice(rate.rateCents)}
                  </Text>
                )}
              </View>
              {isCollapsed && (
                <Ionicons name="chevron-down" size={24} color={theme.colors.primary} />
              )}
            </Pressable>

            {!isCollapsed && (
              <>
                <Text style={styles.addr}>{addrStr || "—"}</Text>
                <Text style={styles.dimLabel}>Package dimensions</Text>
                <View style={styles.dimRow}>
                  <TextInput
                    style={[styles.dimInput, { marginRight: 4 }]}
                    placeholder="Weight (oz)"
                    placeholderTextColor={theme.colors.placeholder}
                    value={dim.weightOz ? String(dim.weightOz) : ""}
                    onChangeText={(v) => updateDim(key, "weightOz", v)}
                    keyboardType="numeric"
                  />
                  <TextInput
                    style={[styles.dimInput, { marginHorizontal: 4 }]}
                    placeholder="L"
                    placeholderTextColor={theme.colors.placeholder}
                    value={dim.lengthIn ? String(dim.lengthIn) : ""}
                    onChangeText={(v) => updateDim(key, "lengthIn", v)}
                    keyboardType="numeric"
                  />
                  <TextInput
                    style={[styles.dimInput, { marginHorizontal: 4 }]}
                    placeholder="W"
                    placeholderTextColor={theme.colors.placeholder}
                    value={dim.widthIn ? String(dim.widthIn) : ""}
                    onChangeText={(v) => updateDim(key, "widthIn", v)}
                    keyboardType="numeric"
                  />
                  <TextInput
                    style={[styles.dimInput, { marginLeft: 4 }]}
                    placeholder="H"
                    placeholderTextColor={theme.colors.placeholder}
                    value={dim.heightIn ? String(dim.heightIn) : ""}
                    onChangeText={(v) => updateDim(key, "heightIn", v)}
                    keyboardType="numeric"
                  />
                </View>
                <Pressable
                  style={({ pressed }) => [styles.ratesBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => getRates(group)}
                  disabled={rateData?.loading}
                >
                  {rateData?.loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.btnText}>Get rates</Text>
                  )}
                </Pressable>

                {rateData?.rates && rateData.rates.length > 0 && (
                  <>
                    <Text style={styles.rateLabel}>Select rate</Text>
                    {rateData.rates.map((r) => (
                      <Pressable
                        key={r.id}
                        style={({ pressed }) => [
                          styles.rateOpt,
                          rate?.id === r.id && styles.rateOptSelected,
                          pressed && { opacity: 0.8 },
                        ]}
                        onPress={() => selectRateAndCollapse(key, r)}
                      >
                        <Text style={styles.rateText}>
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
          <Text style={styles.easypostNote}>
            All labels will be purchased from the payment option on file for your EasyPost account.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.purchaseLabelsBtn, pressed && { opacity: 0.8 }]}
            onPress={purchaseAllLabels}
            disabled={purchasing === "all"}
          >
            {purchasing === "all" ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.btnText}>
                Purchase Labels ({groupsWithRate.length})
              </Text>
            )}
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  hint: { fontSize: 14, color: "#666", marginBottom: 24 },
  empty: { fontSize: 16, color: "#888", marginTop: 16 },
  btn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "600" },
  packingSlipBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 16,
  },
  packingSlipBtnInner: { flexDirection: "row", alignItems: "center" },
  toggle: { marginBottom: 16 },
  toggleText: { fontSize: 14, color: theme.colors.primary, fontWeight: "600" },
  err: { color: "#c62828", marginBottom: 16, fontSize: 14 },
  card: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  orderId: { fontSize: 14, fontWeight: "600", color: theme.colors.primary },
  buyer: { fontSize: 16, fontWeight: "600", marginTop: 4 },
  selectedRate: { fontSize: 14, color: "#2e7d32", marginTop: 4, fontWeight: "500" },
  addr: { fontSize: 14, color: "#666", marginTop: 4, marginBottom: 12 },
  dimLabel: { fontSize: 12, color: "#888", marginBottom: 8 },
  dimRow: { flexDirection: "row", marginBottom: 12 },
  dimInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
  },
  ratesBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  rateLabel: { fontSize: 14, fontWeight: "600", marginBottom: 8 },
  rateOpt: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    marginBottom: 8,
  },
  rateOptSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.creamAlt },
  rateText: { fontSize: 14, color: "#333" },
  purchaseSection: {
    marginTop: 24,
    paddingTop: 20,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  easypostNote: {
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
