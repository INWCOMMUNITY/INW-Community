import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  TextInput,
} from "react-native";
import { useLocalSearchParams, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { theme } from "@/lib/theme";
import { apiPost, apiGet, apiDelete } from "@/lib/api";

type Connection = {
  id: string;
  provider: string;
  shopName: string | null;
  shopId: string | null;
  status: string;
  lastError: string | null;
  hasShippingProfile: boolean;
  readyToPublish: boolean | null;
  linkedListings: number;
};

type ProviderConfig = {
  provider: string;
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  blurb: string;
  available: boolean;
};

// Etsy ships now; eBay / Wix / Shopify activate as their adapters come online.
const PROVIDERS: ProviderConfig[] = [
  {
    provider: "etsy",
    name: "Etsy",
    icon: "storefront-outline",
    blurb: "Sync listings and inventory with your Etsy shop.",
    available: true,
  },
  {
    provider: "ebay",
    name: "eBay",
    icon: "pricetags-outline",
    blurb: "Sync listings and inventory with eBay.",
    available: true,
  },
  {
    provider: "wix",
    name: "Wix",
    icon: "globe-outline",
    blurb: "Sync listings and inventory with your Wix store.",
    available: true,
  },
  {
    provider: "shopify",
    name: "Shopify",
    icon: "bag-handle-outline",
    blurb: "Sync listings and inventory with your Shopify store.",
    available: true,
  },
];

function parseReturnUrl(url: string): { connected: string | null; error: string | null } {
  try {
    const q = Linking.parse(url).queryParams ?? {};
    const connectedRaw = q.connected;
    const errRaw = q.channel_error;
    const connected = Array.isArray(connectedRaw) ? connectedRaw[0] : connectedRaw;
    const errVal = Array.isArray(errRaw) ? errRaw[0] : errRaw;
    const error =
      typeof errVal === "string" && errVal.length > 0
        ? decodeURIComponent(errVal.replace(/\+/g, " "))
        : null;
    return { connected: typeof connected === "string" ? connected : null, error };
  } catch {
    return { connected: null, error: null };
  }
}

export default function ChannelsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ connected?: string; channel_error?: string }>();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [shopifyShop, setShopifyShop] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<Connection[]>("/api/channels");
      setConnections(Array.isArray(data) ? data : []);
    } catch {
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  React.useEffect(() => {
    if (typeof params.connected === "string" && params.connected.length > 0) {
      setSuccess(`${params.connected[0].toUpperCase()}${params.connected.slice(1)} connected.`);
      setError(null);
      void refresh();
    }
    if (typeof params.channel_error === "string" && params.channel_error.length > 0) {
      setError(decodeURIComponent(params.channel_error.replace(/\+/g, " ")));
    }
  }, [params.connected, params.channel_error, refresh]);

  const connectionFor = (provider: string) =>
    connections.find((c) => c.provider === provider && c.status !== "disconnected");

  const connect = async (provider: string) => {
    if (provider === "shopify" && !shopifyShop.trim()) {
      setError("Enter your Shopify store domain (e.g. mystore or mystore.myshopify.com).");
      return;
    }
    setConnecting(provider);
    setError(null);
    setSuccess(null);
    try {
      const body = provider === "shopify" ? { shop: shopifyShop.trim() } : {};
      const { url } = await apiPost<{ url: string }>(`/api/channels/${provider}/connect`, body);
      if (!url) {
        setError("Could not start the connection.");
        return;
      }
      // The callback 302-redirects to this deep link with ?connected / ?channel_error, which
      // closes the in-app browser and lets us read the result below.
      const returnUrl = "inwcommunity://seller-hub/channels";
      const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
      if (result.type === "success" && "url" in result && result.url) {
        const { connected, error: err } = parseReturnUrl(result.url);
        if (err) setError(err);
        else if (connected) setSuccess(`${connected[0].toUpperCase()}${connected.slice(1)} connected.`);
      }
      await refresh();
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Could not connect. Try again.");
    } finally {
      setConnecting(null);
    }
  };

  const testWix = async () => {
    setError(null);
    setSuccess(null);
    try {
      const r = await apiGet<{
        ok: boolean;
        productCount?: number;
        linkedCount?: number;
        catalogApi?: string | null;
        siteId?: string | null;
        listError?: string | null;
        message?: string;
        hint?: string | null;
        syncErrors?: { title: string; error: string | null }[];
      }>("/api/channels/wix/health");
      if (r.ok) {
        const parts = [
          `${r.productCount ?? 0} product(s) on Wix`,
          `${r.linkedCount ?? 0} linked on INW`,
          r.catalogApi ? `catalog ${r.catalogApi}` : null,
        ].filter(Boolean);
        setSuccess(`Wix OK — ${parts.join(" · ")}.`);
        if (r.syncErrors?.length) {
          setError(
            r.syncErrors
              .map((e) => `${e.title}: ${e.error ?? "sync error"}`)
              .join("\n")
          );
        }
      } else {
        setError(r.listError || r.message || r.hint || "Wix test failed.");
      }
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Could not test Wix connection.");
    }
  };

  const testWixPush = async () => {
    setError(null);
    setSuccess(null);
    try {
      const r = await apiPost<{
        ok: boolean;
        writeOk?: boolean;
        title?: string;
        targetQty?: number;
        readBefore?: { quantity: number; known: boolean };
        readAfter?: { quantity: number; known: boolean };
        catalogApi?: string;
        error?: string | null;
        message?: string;
      }>("/api/channels/wix/test-push", {});
      if (r.ok && r.writeOk) {
        setSuccess(
          `Wix write OK${r.title ? ` (“${r.title.slice(0, 40)}”)` : ""} — qty ${r.readBefore?.quantity ?? "?"} → ${r.readAfter?.quantity ?? r.targetQty ?? "?"}.`
        );
      } else {
        setError(r.error || r.message || "Wix write test failed. Import a linked product first.");
      }
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Could not test Wix write.");
    }
  };

  const runDisconnect = async (conn: Connection, name: string, deleteInwItems: boolean) => {
    try {
      const qs = deleteInwItems ? "?deleteInwItems=1" : "";
      const res = await apiDelete<{ deletedInwCount?: number }>(`/api/channels/${conn.id}${qs}`);
      if (deleteInwItems) {
        const n = res.deletedInwCount ?? 0;
        setSuccess(
          `${name} disconnected. ${n} listing${n === 1 ? "" : "s"} removed from INW Community. Your ${name} store is unchanged.`
        );
      } else {
        setSuccess(`${name} disconnected. Your INW listings are unchanged.`);
      }
      setError(null);
      await refresh();
    } catch {
      setError("Could not disconnect. Try again.");
    }
  };

  const disconnect = (conn: Connection, name: string) => {
    const linked =
      conn.linkedListings === 1
        ? "1 linked listing"
        : `${conn.linkedListings} linked listings`;
    const baseMessage =
      conn.linkedListings > 0
        ? `You have ${linked} tied to ${name}. Sync will stop in both directions. Your listings on ${name} are not removed by INW.\n\nNWC is not responsible for inventory, oversells, or other business effects after you disconnect (see Terms of Service).`
        : `Your ${name} account will disconnect from INW Community. Any items you add later on INW will not sync to ${name} until you connect again.`;

    if (conn.linkedListings === 0) {
      Alert.alert(`Disconnect ${name}?`, baseMessage, [
        { text: "Cancel", style: "cancel" },
        { text: "Disconnect", onPress: () => void runDisconnect(conn, name, false) },
      ]);
      return;
    }

    Alert.alert(`Disconnect ${name}?`, baseMessage, [
      { text: "Cancel", style: "cancel" },
      { text: "Keep on INW", onPress: () => void runDisconnect(conn, name, false) },
      {
        text: "Delete from INW",
        style: "destructive",
        onPress: () => {
          Alert.alert(
            "Delete from INW Community?",
            `This permanently removes ${linked} from your INW storefront only. Listings on ${name} stay as they are.\n\nAfter disconnecting, you are responsible for inventory and sales on ${name} and any other channel. INW is not liable for tracking errors, oversells, or business loss from disconnecting a third-party store.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete from INW",
                style: "destructive",
                onPress: () => void runDisconnect(conn, name, true),
              },
            ]
          );
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.hint}>
        List once on INW and keep your items and inventory in sync across marketplaces. A sale on any
        connected store reduces stock everywhere.
      </Text>

      {loading ? (
        <ActivityIndicator style={styles.spinner} color={theme.colors.primary} />
      ) : (
        PROVIDERS.map((p) => {
          const conn = connectionFor(p.provider);
          return (
            <View key={p.provider} style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name={p.icon} size={22} color={theme.colors.primary} />
                <Text style={styles.providerName}>{p.name}</Text>
                {!p.available && <Text style={styles.comingSoon}>Coming soon</Text>}
              </View>
              <Text style={styles.providerBlurb}>{p.blurb}</Text>

              {conn ? (
                <>
                  <View style={styles.bannerOk}>
                    <Text style={styles.bannerOkText}>
                      Connected{conn.shopName ? ` to ${conn.shopName}` : ""}.
                    </Text>
                    <Text style={styles.bannerHint}>
                      {conn.linkedListings} listing{conn.linkedListings === 1 ? "" : "s"} linked.
                    </Text>
                    {p.provider === "etsy" && !conn.hasShippingProfile && (
                      <Text style={styles.warn}>
                        Add a shipping profile on Etsy so listings can publish live.
                      </Text>
                    )}
                    {p.provider === "ebay" && conn.readyToPublish === false && (
                      <Text style={styles.warn}>
                        Add eBay business policies (payment, return, shipping) and a merchant location
                        so listings can publish live.
                      </Text>
                    )}
                    {p.provider === "wix" && (
                      <>
                        <Text style={styles.warn}>
                          Make sure the Wix Stores app is added to your site. Only items imported from
                          Wix (or created with sync on) push changes back to Wix.
                        </Text>
                        {conn.linkedListings === 0 && (
                          <Text style={styles.warn}>
                            No listings linked yet — tap Import existing listings.
                          </Text>
                        )}
                      </>
                    )}
                    {p.provider === "shopify" && conn.readyToPublish === false && (
                      <Text style={styles.warn}>
                        Reconnect Shopify or set an inventory location so quantity sync can run (see
                        SHOPIFY_DEFAULT_LOCATION_ID).
                      </Text>
                    )}
                    {p.provider === "shopify" && conn.readyToPublish !== false && (
                      <Text style={styles.warn}>
                        Your Shopify store needs the Online Store channel and inventory tracking enabled
                        for products to sync.
                      </Text>
                    )}
                    {conn.status === "error" && conn.lastError && (
                      <Text style={styles.warn}>Sync issue: {conn.lastError}</Text>
                    )}
                  </View>
                  {(p.provider === "etsy" ||
                    p.provider === "ebay" ||
                    p.provider === "wix" ||
                    p.provider === "shopify") && (
                    <Pressable
                      style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.85 }]}
                      onPress={() =>
                        router.push(`/seller-hub/channels/import?provider=${p.provider}`)
                      }
                    >
                      <Text style={styles.secondaryBtnText}>Import existing listings</Text>
                    </Pressable>
                  )}
                  {p.provider === "wix" && (
                    <>
                      <Pressable
                        style={({ pressed }) => [
                          styles.secondaryBtn,
                          styles.secondaryBtnSpaced,
                          pressed && { opacity: 0.85 },
                        ]}
                        onPress={() => void testWix()}
                      >
                        <Text style={styles.secondaryBtnText}>Test Wix connection</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [
                          styles.secondaryBtn,
                          styles.secondaryBtnSpaced,
                          pressed && { opacity: 0.85 },
                        ]}
                        onPress={() => void testWixPush()}
                      >
                        <Text style={styles.secondaryBtnText}>Test Wix write (qty push)</Text>
                      </Pressable>
                    </>
                  )}
                  <Pressable
                    style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.6 }]}
                    onPress={() => disconnect(conn, p.name)}
                  >
                    <Text style={styles.linkBtnText}>Disconnect {p.name}</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  {p.provider === "shopify" && (
                    <TextInput
                      style={styles.shopInput}
                      placeholder="mystore or mystore.myshopify.com"
                      placeholderTextColor="#999"
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={shopifyShop}
                      onChangeText={setShopifyShop}
                    />
                  )}
                  <Pressable
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    pressed && { opacity: 0.85 },
                    (!p.available || connecting === p.provider) && styles.primaryBtnDisabled,
                  ]}
                  onPress={() => p.available && connect(p.provider)}
                  disabled={!p.available || connecting === p.provider}
                >
                  {connecting === p.provider ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.primaryBtnText}>
                      {p.available ? `Connect ${p.name}` : "Coming soon"}
                    </Text>
                  )}
                </Pressable>
                </>
              )}
            </View>
          );
        })
      )}

      {success && !error && <Text style={styles.success}>{success}</Text>}
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  hint: { fontSize: 14, color: "#666", marginBottom: 20 },
  spinner: { marginVertical: 16 },
  card: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  providerName: { fontSize: 17, fontWeight: "700", color: theme.colors.heading },
  comingSoon: {
    marginLeft: "auto",
    fontSize: 12,
    fontWeight: "600",
    color: "#b26a00",
    backgroundColor: "#fff3e0",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: "hidden",
  },
  providerBlurb: { fontSize: 13, color: "#666", marginTop: 6, marginBottom: 14 },
  shopInput: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 12,
    color: "#000",
  },
  bannerOk: { backgroundColor: "#e8f5e9", borderRadius: 8, padding: 12, marginBottom: 12 },
  bannerOkText: { fontSize: 15, fontWeight: "600", color: "#2e7d32" },
  bannerHint: { fontSize: 13, color: "#666", marginTop: 6 },
  warn: { fontSize: 13, color: "#b26a00", marginTop: 6 },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  secondaryBtnSpaced: { marginTop: 12 },
  secondaryBtnText: { color: theme.colors.primary, fontWeight: "600", fontSize: 15 },
  linkBtn: { paddingVertical: 12, alignItems: "center" },
  linkBtnText: { color: "#c62828", fontSize: 14 },
  success: { color: "#2e7d32", marginTop: 8, fontSize: 14 },
  err: { color: "#c62828", marginTop: 8, fontSize: 14 },
});
