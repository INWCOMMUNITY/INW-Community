import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";
import { airportStyles as styles } from "@/components/apps-airport/chrome";

type Connection = {
  id: string;
  shopDomain: string;
  generation: number;
  status: string;
  primaryLocationId: string | null;
  inventoryReady: boolean;
  locationSelectionRequired: boolean;
};

type LocationOption = { id: string; name: string };

function errMessage(e: unknown, fallback: string) {
  return (e as { error?: string }).error || fallback;
}

export default function ShopifySettingsScreen() {
  const [shop, setShop] = useState("");
  const [connection, setConnection] = useState<Connection | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const body = await apiGet<{ connections: Connection[] }>("/api/shopify/connection");
      const active = body.connections.find((c) => c.status === "ACTIVE") ?? null;
      setConnection(active);
      if (active?.locationSelectionRequired) {
        const loc = await apiGet<{ locations: LocationOption[] }>(
          `/api/shopify/locations?connectionId=${encodeURIComponent(active.id)}`
        ).catch(() => ({ locations: [] as LocationOption[] }));
        setLocations(loc.locations ?? []);
      } else {
        setLocations([]);
      }
    } catch (e) {
      setError(errMessage(e, "Could not load Shopify connection."));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onConnect = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body = await apiPost<{ authorizeUrl?: string }>("/api/shopify/connect", { shop });
      if (!body.authorizeUrl) {
        setError("Could not start Shopify connection.");
        return;
      }
      await WebBrowser.openBrowserAsync(body.authorizeUrl);
      setMessage("If you finished connecting in the browser, pull to refresh or reopen this screen.");
      await load();
    } catch (e) {
      setError(errMessage(e, "Could not start Shopify connection."));
    } finally {
      setBusy(false);
    }
  };

  const onSelectLocation = async (locationId: string) => {
    if (!connection) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/shopify/location", { connectionId: connection.id, locationId });
      setMessage("Primary Shopify location saved.");
      await load();
    } catch (e) {
      setError(errMessage(e, "Could not save the Shopify location."));
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = () => {
    if (!connection) return;
    Alert.alert("Disconnect Shopify?", "Inventory sync to this shop will stop.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: () => {
          setBusy(true);
          setError(null);
          void apiPost("/api/shopify/disconnect", { connectionId: connection.id })
            .then(async () => {
              setMessage("Shopify disconnected.");
              await load();
            })
            .catch((e) => setError(errMessage(e, "Could not disconnect Shopify.")))
            .finally(() => setBusy(false));
        },
      },
    ]);
  };

  const status = !connection
    ? "Not connected"
    : connection.locationSelectionRequired || !connection.inventoryReady
      ? "Needs attention"
      : "Connected";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>
        Connect one Shopify shop. Inventory sync uses a single location after you choose it. Enter
        your-store.myshopify.com, a full store URL, or a supported Shopify Admin URL.
      </Text>
      {message ? <Text style={styles.ok}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator color={theme.colors.primary} /> : null}

      {!loading ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Status: {status}</Text>
          {connection ? (
            <>
              <Text style={styles.shopLine}>{connection.shopDomain}</Text>
              <Text style={styles.meta}>Generation {connection.generation}</Text>
              <Text style={styles.meta}>
                Primary location:{" "}
                {connection.primaryLocationId
                  ? "Selected"
                  : "Not selected — required before syncing inventory"}
              </Text>
              <Text style={styles.meta}>
                {connection.inventoryReady
                  ? "Location ready for inventory sync"
                  : "Choose a location before inventory sync"}
              </Text>
            </>
          ) : (
            <Text style={styles.cardBody}>No active Shopify shop connected.</Text>
          )}
        </View>
      ) : null}

      {!loading && !connection ? (
        <>
          <Text style={styles.label}>Shopify shop</Text>
          <TextInput
            style={styles.input}
            placeholder="your-store.myshopify.com"
            placeholderTextColor="#888"
            autoCapitalize="none"
            autoCorrect={false}
            value={shop}
            onChangeText={setShop}
          />
          <View style={{ height: 12 }} />
          <Pressable
            style={({ pressed }) => [
              { backgroundColor: theme.colors.primary, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
              (busy || pressed) && { opacity: 0.85 },
            ]}
            disabled={busy}
            onPress={() => void onConnect()}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>{busy ? "Connecting…" : "Connect Shopify"}</Text>
          </Pressable>
        </>
      ) : null}

      {connection?.locationSelectionRequired && locations.length > 0 ? (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.label}>Choose a fulfillment location</Text>
          {locations.map((location) => (
            <Pressable key={location.id} onPress={() => void onSelectLocation(location.id)} disabled={busy}>
              <Text style={{ color: theme.colors.primary, fontSize: 16, marginBottom: 10 }}>
                Use {location.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {connection ? (
        <Pressable onPress={onDisconnect} disabled={busy} style={{ marginTop: 20 }}>
          <Text style={{ color: "#b91c1c", fontSize: 16 }}>Disconnect</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
