import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { apiGet } from "@/lib/api";
import { theme } from "@/lib/theme";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

type ShopifyConnection = {
  id: string;
  shopDomain: string;
  status: "ACTIVE" | "DISCONNECTED" | "REVOKED";
  inventoryReady: boolean;
  locationSelectionRequired: boolean;
};

type EtsyConnection = {
  id: string;
  shopId: string;
  shopName: string | null;
  status: "ACTIVE" | "DISCONNECTED" | "REVOKED";
};

type ShopifyUi = "connected" | "needs_attention" | "disconnected";
type EtsyUi = "connected" | "disconnected";

function classifyShopify(conn: ShopifyConnection | null): ShopifyUi {
  if (!conn || conn.status !== "ACTIVE") return "disconnected";
  if (conn.locationSelectionRequired || !conn.inventoryReady) return "needs_attention";
  return "connected";
}

function shopifyStatusLabel(status: ShopifyUi): string {
  if (status === "connected") return "Connected";
  if (status === "needs_attention") return "Needs attention";
  return "Not connected";
}

function etsyStatusLabel(status: EtsyUi): string {
  return status === "connected" ? "Connected" : "Not connected";
}

function statusColors(status: ShopifyUi | EtsyUi) {
  if (status === "connected") return { bg: "#e8f5e9", fg: theme.colors.heading };
  if (status === "needs_attention") return { bg: "#fff8e1", fg: theme.colors.heading };
  return { bg: "#f5f5f5", fg: theme.colors.heading };
}

export default function SyncAirportScreen() {
  const router = useRouter();
  const [shopify, setShopify] = useState<ShopifyConnection | null>(null);
  const [etsy, setEtsy] = useState<EtsyConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      apiGet<{ connections?: ShopifyConnection[] }>("/api/shopify/connection").catch(() => null),
      apiGet<{ connections?: EtsyConnection[] }>("/api/etsy/connection").catch(() => null),
    ])
      .then(([shopifyBody, etsyBody]) => {
        if (!shopifyBody && !etsyBody) {
          setError("Could not load marketplace connections.");
          return;
        }
        setError(null);
        const shopifyRows = shopifyBody?.connections ?? [];
        const etsyRows = etsyBody?.connections ?? [];
        setShopify(shopifyRows.find((c) => c.status === "ACTIVE") ?? null);
        setEtsy(etsyRows.find((c) => c.status === "ACTIVE") ?? null);
      })
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

  const openWeb = (path: string, title: string) => {
    const url = `${siteBase}${path}`;
    router.push(`/web?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}` as never);
  };

  const shopifyUi = classifyShopify(shopify);
  const etsyUi: EtsyUi = etsy ? "connected" : "disconnected";
  const shopifyChip = statusColors(shopifyUi);
  const etsyChip = statusColors(etsyUi);

  if (loading && !shopify && !etsy && !error) {
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
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }
    >
      <Text style={styles.subtitle}>
        Connect marketplaces and manage synced listings from one place.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.titleRow}>
            <Ionicons name="bag-handle-outline" size={26} color={theme.colors.primary} />
            <Text style={styles.cardTitle}>Shopify</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: shopifyChip.bg }]}>
            <Text style={[styles.badgeText, { color: shopifyChip.fg }]}>
              {loading ? "…" : shopifyStatusLabel(shopifyUi)}
            </Text>
          </View>
        </View>
        <Text style={styles.cardBody}>Sync INW listings to your Shopify store.</Text>
        <Text style={styles.shopLine}>
          {shopify ? `Shop: ${shopify.shopDomain}` : "No Shopify shop connected yet."}
        </Text>
        <View style={styles.actions}>
          {shopify ? (
            <Pressable
              style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
              onPress={() => router.push("/seller-hub/shopify" as never)}
            >
              <Text style={styles.actionBtnText}>Manage Shopify Sync</Text>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
              onPress={() => openWeb("/seller-hub/apps/shopify/settings", "Connection Settings")}
            >
              <Text style={styles.actionBtnText}>Connect</Text>
            </Pressable>
          )}
          {shopify && shopifyUi === "needs_attention" ? (
            <Pressable
              style={({ pressed }) => [styles.outlineBtn, pressed && styles.pressed]}
              onPress={() => openWeb("/seller-hub/apps/shopify/settings", "Connection Settings")}
            >
              <Text style={styles.outlineBtnText}>Finish setup</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.titleRow}>
            <Ionicons name="color-palette-outline" size={26} color={theme.colors.primary} />
            <Text style={styles.cardTitle}>Etsy</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: etsyChip.bg }]}>
            <Text style={[styles.badgeText, { color: etsyChip.fg }]}>
              {loading ? "…" : etsyStatusLabel(etsyUi)}
            </Text>
          </View>
        </View>
        <Text style={styles.cardBody}>
          Connect your Etsy shop, set How it’s made on listings, then list from Sync Airport.
        </Text>
        <Text style={styles.shopLine}>
          {etsy
            ? `Shop: ${etsy.shopName ?? `#${etsy.shopId}`}`
            : "No Etsy shop connected yet."}
        </Text>
        <View style={styles.actions}>
          {etsy ? (
            <Pressable
              style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
              onPress={() => router.push("/seller-hub/apps/etsy" as never)}
            >
              <Text style={styles.actionBtnText}>Manage Etsy Sync</Text>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
              onPress={() => openWeb("/seller-hub/apps/etsy/settings", "Connection Settings")}
            >
              <Text style={styles.actionBtnText}>Connect</Text>
            </Pressable>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  subtitle: { fontSize: 14, color: "#666", marginBottom: 4 },
  error: { color: "#b91c1c", fontSize: 14 },
  card: {
    borderWidth: 4,
    borderColor: theme.colors.primary,
    borderRadius: 10,
    backgroundColor: "#fff",
    padding: 16,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  cardTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: "700" },
  cardBody: { marginTop: 8, fontSize: 14, color: "#525252", lineHeight: 20 },
  shopLine: { marginTop: 10, fontSize: 14, color: "#404040" },
  actions: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 10,
  },
  actionBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minWidth: 180,
    alignItems: "center",
  },
  actionBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  outlineBtn: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minWidth: 180,
    alignItems: "center",
  },
  outlineBtnText: { color: theme.colors.heading, fontWeight: "600", fontSize: 15 },
  pressed: { opacity: 0.85 },
});
