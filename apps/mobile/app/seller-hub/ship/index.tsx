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
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";
import { formatShippingAddress } from "@/lib/format-address";

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

  const purchaseLabel = async (group: StoreOrder[]) => {
    const key = groupKey(group);
    const rate = selectedRate[key];
    const rateData = rates[key];
    const dim = dims[key];
    if (!rate || !rateData?.shipmentId || !dim) return;

    setPurchasing(key);
    setError(null);
    try {
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
      const url = res.shipment?.labelUrl;
      if (url) Linking.openURL(url).catch(() => {});
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Failed to purchase label");
    } finally {
      setPurchasing(null);
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
      <View style={styles.container}>
        <Text style={styles.title}>Ship Items</Text>
        <Text style={styles.hint}>No orders need shipping. Labels are charged to your EasyPost account.</Text>
        <Text style={styles.empty}>No orders to ship</Text>
      </View>
    );
  }

  const hasMultipleBuyers = new Set(orders.map((o) => o.buyer?.email)).size < orders.length;

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

      {hasMultipleBuyers && (
        <Pressable
          style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.8 }]}
          onPress={() => setCombineByBuyer((b) => !b)}
        >
          <Text style={styles.toggleText}>
            {combineByBuyer ? "✓ " : ""}Combine orders for same buyer
          </Text>
        </Pressable>
      )}

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
        const addr = order.shippingAddress as Record<string, string> | null;
        const addrStr = formatShippingAddress(addr);

        return (
          <View key={key} style={styles.card}>
            <Text style={styles.orderId}>
              {group.length === 1 ? `#${order.id.slice(-6)}` : `${group.length} orders (same buyer)`}
            </Text>
            <Text style={styles.buyer}>
              {order.buyer?.firstName} {order.buyer?.lastName}
            </Text>
            <Text style={styles.addr}>{addrStr || "—"}</Text>
            <Text style={styles.dimLabel}>Package dimensions</Text>
            <View style={styles.dimRow}>
              <TextInput
                style={styles.dimInput}
                placeholder="Weight (oz)"
                placeholderTextColor={theme.colors.placeholder}
                value={dim.weightOz ? String(dim.weightOz) : ""}
                onChangeText={(v) => updateDim(key, "weightOz", v)}
                keyboardType="numeric"
              />
              <TextInput
                style={styles.dimInput}
                placeholder="L"
                placeholderTextColor={theme.colors.placeholder}
                value={dim.lengthIn ? String(dim.lengthIn) : ""}
                onChangeText={(v) => updateDim(key, "lengthIn", v)}
                keyboardType="numeric"
              />
              <TextInput
                style={styles.dimInput}
                placeholder="W"
                placeholderTextColor={theme.colors.placeholder}
                value={dim.widthIn ? String(dim.widthIn) : ""}
                onChangeText={(v) => updateDim(key, "widthIn", v)}
                keyboardType="numeric"
              />
              <TextInput
                style={styles.dimInput}
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
                    onPress={() => setSelectedRate((prev) => ({ ...prev, [key]: r }))}
                  >
                    <Text style={styles.rateText}>
                      {r.carrier} {r.service} — {formatPrice(r.rateCents)}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  style={({ pressed }) => [styles.buyBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => purchaseLabel(group)}
                  disabled={purchasing === key || !rate}
                >
                  {purchasing === key ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.btnText}>Purchase label</Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        );
      })}
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
  toggle: { marginBottom: 16 },
  toggleText: { fontSize: 14, color: theme.colors.primary, fontWeight: "600" },
  err: { color: "#c62828", marginBottom: 16, fontSize: 14 },
  card: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  orderId: { fontSize: 14, fontWeight: "600", color: theme.colors.primary },
  buyer: { fontSize: 16, fontWeight: "600", marginTop: 4 },
  addr: { fontSize: 14, color: "#666", marginTop: 4, marginBottom: 12 },
  dimLabel: { fontSize: 12, color: "#888", marginBottom: 8 },
  dimRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
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
  buyBtn: {
    backgroundColor: "#2e7d32",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
});
