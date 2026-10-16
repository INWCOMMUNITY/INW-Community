import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";
import { HubButton, airportStyles as styles } from "@/components/apps-airport/chrome";

type EligibleListing = {
  storeItemId: string;
  title: string;
  priceCents: number;
  quantity: number;
  sku: string | null;
  variantCount?: number;
  supported?: boolean;
  unsupportedReason?: string | null;
  needsShopifyMetafields?: boolean;
  usesSharedQuantityPool?: boolean;
};

function errMessage(e: unknown, fallback: string) {
  return (e as { error?: string }).error || fallback;
}

export default function ShopifySyncScreen() {
  const router = useRouter();
  const [listings, setListings] = useState<EligibleListing[]>([]);
  const [inventoryReady, setInventoryReady] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const body = await apiGet<{
        inventoryReady?: boolean;
        connectionStatus?: string;
        listings: EligibleListing[];
      }>("/api/shopify/listings/eligible");
      setInventoryReady(Boolean(body.inventoryReady));
      setListings(body.listings ?? []);
    } catch (e) {
      setError(errMessage(e, "Could not load eligible listings."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const enqueue = async (targets: EligibleListing[]) => {
    if (targets.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const failures: string[] = [];
    let started = 0;
    try {
      for (const listing of targets) {
        try {
          const body = await apiPost<{ status?: string }>("/api/shopify/listings/create", {
            storeItemId: listing.storeItemId,
          });
          if (body.status === "already_mapped" || body.status === "queued" || body.status == null) {
            started += 1;
          }
        } catch (e) {
          failures.push(`${listing.title}: ${errMessage(e, "Could not start Shopify sync.")}`);
        }
      }
      setSelected(new Set());
      if (failures.length === 0) {
        setMessage(
          started === 1 ? "Listing queued for Shopify." : `${started} listings queued for Shopify.`
        );
      } else {
        setError(failures[0] ?? "Some listings could not be started.");
        if (started > 0) setMessage(`${started} started, ${failures.length} failed.`);
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const requestEnqueue = (targets: EligibleListing[]) => {
    const blocked = targets.filter((listing) => listing.usesSharedQuantityPool);
    const compatible = targets.filter((listing) => !listing.usesSharedQuantityPool);
    const go = (rows: EligibleListing[]) => {
      if (rows.some((listing) => listing.needsShopifyMetafields)) {
        Alert.alert(
          "Custom options",
          "Some of these listings have custom options. Shopify stores those as metafields. Continue listing?",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Continue", onPress: () => void enqueue(rows) },
          ]
        );
        return;
      }
      void enqueue(rows);
    };
    if (blocked.length > 0) {
      Alert.alert(
        "Shared quantity",
        "Shared quantity pools are not compatible with Shopify. Those listings will be skipped. List the rest?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: compatible.length ? "List the rest" : "OK",
            onPress: () => {
              if (compatible.length) go(compatible);
            },
          },
        ]
      );
      return;
    }
    go(targets);
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading && listings.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const chosen = listings.filter((row) => selected.has(row.storeItemId) && row.supported !== false);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />
      }
    >
      <Text style={styles.subtitle}>
        Active INW listings that are not on Shopify yet. Live means published on the Online Store,
        not left as a draft.
      </Text>
      {!inventoryReady ? (
        <Text style={styles.issue}>
          Choose a Shopify location in Connection Settings before listing.
        </Text>
      ) : null}
      {message ? <Text style={styles.ok}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <HubButton
        label={busy ? "Listing…" : chosen.length ? `List selected (${chosen.length})` : "List selected"}
        disabled={!inventoryReady || busy || chosen.length === 0}
        onPress={() => requestEnqueue(chosen)}
      />
      <View style={{ height: 14 }} />
      {listings.length === 0 ? (
        <Text style={styles.hint}>No eligible listings right now.</Text>
      ) : (
        listings.map((listing) => {
          const supported = listing.supported !== false;
          const on = selected.has(listing.storeItemId);
          return (
            <Pressable
              key={listing.storeItemId}
              style={[styles.listCard, on && { borderColor: theme.colors.primary }]}
              disabled={!supported || !inventoryReady || busy}
              onPress={() => toggle(listing.storeItemId)}
            >
              <Text style={styles.listTitle}>
                {on ? "✓ " : ""}
                {listing.title}
              </Text>
              <Text style={styles.meta}>
                ${(listing.priceCents / 100).toFixed(2)} · Qty {listing.quantity}
                {listing.variantCount ? ` · ${listing.variantCount} variants` : ""}
                {listing.sku ? ` · ${listing.sku}` : ""}
              </Text>
              {!supported && listing.unsupportedReason ? (
                <Text style={styles.issue}>{listing.unsupportedReason}</Text>
              ) : null}
              {supported ? (
                <Pressable
                  onPress={() => requestEnqueue([listing])}
                  disabled={!inventoryReady || busy}
                  style={{ marginTop: 8 }}
                >
                  <Text style={{ color: theme.colors.primary, fontWeight: "700" }}>List on Shopify</Text>
                </Pressable>
              ) : null}
            </Pressable>
          );
        })
      )}
      <Pressable onPress={() => router.push("/seller-hub/shopify/settings" as never)} style={{ marginTop: 8 }}>
        <Text style={{ color: theme.colors.primary }}>Connection Settings</Text>
      </Pressable>
    </ScrollView>
  );
}
