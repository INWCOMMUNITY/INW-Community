import React, { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { HubButton, StatusBadge, airportStyles as styles } from "@/components/apps-airport/chrome";

type ShopifyConnection = {
  id: string;
  shopDomain: string;
  status: string;
  inventoryReady: boolean;
  locationSelectionRequired: boolean;
};

type EtsyConnection = {
  id: string;
  shopId: string;
  shopName: string | null;
  status: string;
};

function shopifyLabel(conn: ShopifyConnection | null): { label: string; tone: "ok" | "warn" | "muted" } {
  if (!conn || conn.status !== "ACTIVE") return { label: "Not connected", tone: "muted" };
  if (conn.locationSelectionRequired || !conn.inventoryReady) return { label: "Needs attention", tone: "warn" };
  return { label: "Connected", tone: "ok" };
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
      apiGet<{ connections: ShopifyConnection[] }>("/api/shopify/connection").catch(() => null),
      apiGet<{ connections: EtsyConnection[] }>("/api/etsy/connection").catch(() => null),
    ])
      .then(([shopifyBody, etsyBody]) => {
        if (!shopifyBody && !etsyBody) {
          setError("Could not load marketplace connections.");
          return;
        }
        setError(null);
        setShopify(shopifyBody?.connections?.find((c) => c.status === "ACTIVE") ?? null);
        setEtsy(etsyBody?.connections?.find((c) => c.status === "ACTIVE") ?? null);
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

  const shopifyUi = shopifyLabel(shopify);

  if (loading && !shopify && !etsy) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
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
      <Text style={styles.title}>Sync Airport</Text>
      <Text style={styles.subtitle}>Connect marketplaces and manage synced listings from one place.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.cardTitle}>Shopify</Text>
          <StatusBadge label={loading ? "…" : shopifyUi.label} tone={shopifyUi.tone} />
        </View>
        <Text style={styles.cardBody}>Sync INW listings to your Shopify store.</Text>
        <Text style={styles.shopLine}>
          {shopify ? `Shop: ${shopify.shopDomain}` : "No Shopify shop connected yet."}
        </Text>
        <View style={styles.actions}>
          {shopify ? (
            <HubButton label="Manage Shopify Sync" onPress={() => router.push("/seller-hub/shopify" as never)} />
          ) : (
            <HubButton
              label="Connect"
              onPress={() => router.push("/seller-hub/shopify/settings" as never)}
            />
          )}
          {shopify && shopifyUi.tone === "warn" ? (
            <HubButton
              label="Finish setup"
              tone="earth"
              onPress={() => router.push("/seller-hub/shopify/settings" as never)}
            />
          ) : null}
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.cardTitle}>Etsy</Text>
          <StatusBadge
            label={loading ? "…" : etsy ? "Connected" : "Not connected"}
            tone={etsy ? "ok" : "muted"}
          />
        </View>
        <Text style={styles.cardBody}>
          Connect your Etsy shop, set How it’s made on listings, then list from Sync Airport.
        </Text>
        <Text style={styles.shopLine}>
          {etsy ? `Shop: ${etsy.shopName ?? `#${etsy.shopId}`}` : "No Etsy shop connected yet."}
        </Text>
        <View style={styles.actions}>
          {etsy ? (
            <HubButton label="Manage Etsy Sync" onPress={() => router.push("/seller-hub/etsy" as never)} />
          ) : (
            <HubButton label="Connect" onPress={() => router.push("/seller-hub/etsy/settings" as never)} />
          )}
        </View>
      </View>
    </ScrollView>
  );
}
