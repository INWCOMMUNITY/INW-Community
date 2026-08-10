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
import { EbaySetupCard } from "@/components/channels/EbaySetupCard";
import { SyncHealthWidget } from "@/components/channels/SyncHealthWidget";
import { SyncRulesCard } from "@/components/channels/SyncRulesCard";
import { ChannelSettingsModal } from "@/components/channels/ChannelSettingsModal";
import { SyncOnboarding } from "@/components/channels/SyncOnboarding";

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

// eBay OAuth session lives in the in-app browser cookie jar, not in the INW profile.
const EBAY_SIGN_OUT_URL = "https://signin.ebay.com/logout/confirm";
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
  const [syncing, setSyncing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [shopifyShop, setShopifyShop] = useState("");
  
  // Channel settings modal state
  const [settingsModal, setSettingsModal] = useState<{
    visible: boolean;
    connectionId: string;
    provider: string;
    providerName: string;
  }>({ visible: false, connectionId: "", provider: "", providerName: "" });

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

  const logoutEbay = (ebayName: string) => {
    Alert.alert(
      `Logout of ${ebayName}?`,
      "This only clears the eBay browser session on this device. Your INW ↔ eBay sync keeps running until you tap Disconnect.\n\nSign-out lets you reconnect a different eBay account next time.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Logout",
          onPress: async () => {
            setError(null);
            setSuccess(null);
            try {
              await WebBrowser.openBrowserAsync(EBAY_SIGN_OUT_URL);
              setSuccess(`eBay sign-out opened for ${ebayName}. Reconnect when you're ready.`);
            } catch {
              setError("Could not open eBay sign out. Try again or sign out at ebay.com in Safari.");
            }
          },
        },
      ]
    );
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

  const syncNow = async (conn: Connection, name: string) => {
    setSyncing(conn.id);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiPost<{ ok: boolean; applied?: number; error?: string }>(
        `/api/channels/${conn.id}/reconcile`,
        {}
      );
      if (res.ok) {
        const appliedText =
          res.applied && res.applied > 0
            ? ` ${res.applied} sale${res.applied === 1 ? "" : "s"} applied.`
            : "";
        setSuccess(`${name} synced.${appliedText}`);
        await refresh();
      } else {
        setError(res.error || `Could not sync ${name}. Try again.`);
      }
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? `Could not sync ${name}. Try again.`);
    } finally {
      setSyncing(null);
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
      {/* Onboarding slideshow - shows until user dismisses */}
      <SyncOnboarding />
      
      <Text style={styles.hint}>
        List once on INW and keep your items and inventory in sync across marketplaces. A sale on any
        connected store reduces stock everywhere.
      </Text>

      {!loading && connections.length > 0 && <SyncHealthWidget />}
      {!loading && connections.length > 0 && <SyncRulesCard />}

      {loading ? (
        <ActivityIndicator style={styles.spinner} color={theme.colors.primary} />
      ) : (
        <>
          {/* Connected Platforms Section */}
          {connections.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Ionicons name="checkmark-circle" size={20} color="#2e7d32" />
                <Text style={styles.sectionTitle}>Connected Platforms</Text>
                <Text style={styles.sectionCount}>{connections.length}</Text>
              </View>
              {PROVIDERS.filter((p) => connectionFor(p.provider)).map((p) => {
                const conn = connectionFor(p.provider)!;
                return (
                  <View key={p.provider} style={[styles.card, styles.cardConnected]}>
                    <View style={styles.cardHeader}>
                      <Ionicons name={p.icon} size={22} color={theme.colors.primary} />
                      <Text style={styles.providerName}>{p.name}</Text>
                      <View style={styles.statusBadge}>
                        <Ionicons 
                          name={conn.status === "error" ? "alert-circle" : "ellipse"} 
                          size={10} 
                          color={conn.status === "error" ? "#c62828" : "#2e7d32"} 
                        />
                        <Text style={[
                          styles.statusText,
                          conn.status === "error" && styles.statusTextError
                        ]}>
                          {conn.status === "error" ? "Issue" : "Active"}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.providerBlurb}>
                      {conn.shopName ? `Connected to ${conn.shopName}` : "Connected"} • {conn.linkedListings} listing{conn.linkedListings === 1 ? "" : "s"} linked
                    </Text>

                    {conn.status === "error" && conn.lastError && (
                      <View style={styles.errorBanner}>
                        <Ionicons name="alert-circle-outline" size={16} color="#c62828" />
                        <Text style={styles.errorText}>{conn.lastError}</Text>
                      </View>
                    )}
                    {p.provider === "etsy" && !conn.hasShippingProfile && (
                      <Text style={styles.warn}>
                        Add a shipping profile on Etsy so listings can publish live.
                      </Text>
                    )}
                    {p.provider === "ebay" && conn.readyToPublish === false && (
                      <EbaySetupCard onSetupComplete={refresh} />
                    )}
                    {p.provider === "wix" && conn.linkedListings === 0 && (
                      <Text style={styles.warn}>
                        No listings linked yet — tap Import existing listings.
                      </Text>
                    )}

                    <View style={styles.actionButtons}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.actionBtn,
                          styles.actionBtnPrimary,
                          pressed && { opacity: 0.85 },
                          syncing === conn.id && styles.primaryBtnDisabled,
                        ]}
                        onPress={() => void syncNow(conn, p.name)}
                        disabled={syncing === conn.id}
                      >
                        {syncing === conn.id ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <>
                            <Ionicons name="sync" size={16} color="#fff" />
                            <Text style={styles.actionBtnTextPrimary}>Sync Now</Text>
                          </>
                        )}
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [
                          styles.actionBtn,
                          pressed && { opacity: 0.85 },
                        ]}
                        onPress={() =>
                          router.push(`/seller-hub/channels/import?provider=${p.provider}`)
                        }
                      >
                        <Ionicons name="download-outline" size={16} color={theme.colors.primary} />
                        <Text style={styles.actionBtnText}>Import</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [
                          styles.actionBtn,
                          pressed && { opacity: 0.85 },
                        ]}
                        onPress={() =>
                          setSettingsModal({
                            visible: true,
                            connectionId: conn.id,
                            provider: p.provider,
                            providerName: p.name,
                          })
                        }
                      >
                        <Ionicons name="settings-outline" size={16} color={theme.colors.primary} />
                        <Text style={styles.actionBtnText}>Settings</Text>
                      </Pressable>
                    </View>

                    {p.provider === "wix" && (
                      <View style={styles.extraActions}>
                        <Pressable
                          style={({ pressed }) => [styles.linkAction, pressed && { opacity: 0.6 }]}
                          onPress={() => void testWix()}
                        >
                          <Text style={styles.linkActionText}>Test Connection</Text>
                        </Pressable>
                        <Pressable
                          style={({ pressed }) => [styles.linkAction, pressed && { opacity: 0.6 }]}
                          onPress={() => void testWixPush()}
                        >
                          <Text style={styles.linkActionText}>Test Write</Text>
                        </Pressable>
                      </View>
                    )}
                    {p.provider === "ebay" && (
                      <Pressable
                        style={({ pressed }) => [styles.linkAction, pressed && { opacity: 0.6 }]}
                        onPress={() => void logoutEbay(conn.shopName || conn.shopId || "eBay")}
                      >
                        <Text style={styles.linkActionText}>Logout of eBay Session</Text>
                      </Pressable>
                    )}
                    <Pressable
                      style={({ pressed }) => [styles.disconnectLink, pressed && { opacity: 0.6 }]}
                      onPress={() => disconnect(conn, p.name)}
                    >
                      <Text style={styles.disconnectText}>Disconnect {p.name}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </>
          )}

          {/* Available Platforms Section */}
          {PROVIDERS.filter((p) => !connectionFor(p.provider) && p.available).length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Ionicons name="add-circle-outline" size={20} color="#666" />
                <Text style={styles.sectionTitle}>Available Platforms</Text>
              </View>
              {PROVIDERS.filter((p) => !connectionFor(p.provider) && p.available).map((p) => (
                <View key={p.provider} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Ionicons name={p.icon} size={22} color={theme.colors.primary} />
                    <Text style={styles.providerName}>{p.name}</Text>
                  </View>
                  <Text style={styles.providerBlurb}>{p.blurb}</Text>

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
                      connecting === p.provider && styles.primaryBtnDisabled,
                    ]}
                    onPress={() => connect(p.provider)}
                    disabled={connecting === p.provider}
                  >
                    {connecting === p.provider ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.primaryBtnText}>Connect {p.name}</Text>
                    )}
                  </Pressable>
                </View>
              ))}
            </>
          )}

          {/* Coming Soon Section */}
          {PROVIDERS.filter((p) => !p.available).length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Ionicons name="time-outline" size={20} color="#999" />
                <Text style={[styles.sectionTitle, { color: "#999" }]}>Coming Soon</Text>
              </View>
              {PROVIDERS.filter((p) => !p.available).map((p) => (
                <View key={p.provider} style={[styles.card, styles.cardDisabled]}>
                  <View style={styles.cardHeader}>
                    <Ionicons name={p.icon} size={22} color="#999" />
                    <Text style={[styles.providerName, { color: "#999" }]}>{p.name}</Text>
                    <Text style={styles.comingSoon}>Coming soon</Text>
                  </View>
                  <Text style={[styles.providerBlurb, { color: "#bbb" }]}>{p.blurb}</Text>
                </View>
              ))}
            </>
          )}
        </>
      )}

      {success && !error && <Text style={styles.success}>{success}</Text>}
      {error ? <Text style={styles.err}>{error}</Text> : null}

      <Pressable
        style={styles.activityLink}
        onPress={() => router.push("/seller-hub/channels/sync-activity" as never)}
      >
        <Ionicons name="time-outline" size={18} color={theme.colors.primary} />
        <Text style={styles.activityLinkText}>Sync Activity</Text>
        <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
      </Pressable>

      <ChannelSettingsModal
        visible={settingsModal.visible}
        connectionId={settingsModal.connectionId}
        provider={settingsModal.provider}
        providerName={settingsModal.providerName}
        onClose={() => setSettingsModal({ visible: false, connectionId: "", provider: "", providerName: "" })}
        onSaved={refresh}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  content: { padding: 16, paddingBottom: 40 },
  hint: { fontSize: 14, color: "#666", marginBottom: 16, paddingHorizontal: 4 },
  spinner: { marginVertical: 16 },
  
  // Section headers for grouping
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
    flex: 1,
  },
  sectionCount: {
    fontSize: 13,
    fontWeight: "600",
    color: "#fff",
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 12,
    overflow: "hidden",
  },
  
  card: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardConnected: {
    borderColor: "#c8e6c9",
    borderLeftWidth: 4,
    borderLeftColor: "#2e7d32",
  },
  cardDisabled: {
    backgroundColor: "#fafafa",
    opacity: 0.7,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  providerName: { fontSize: 17, fontWeight: "700", color: theme.colors.heading, flex: 1 },
  
  // Status badge
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "#e8f5e9",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#2e7d32",
  },
  statusTextError: {
    color: "#c62828",
  },
  
  comingSoon: {
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
  
  // Error banner
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#ffebee",
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: "#c62828",
  },
  
  // Action buttons row
  actionButtons: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  actionBtnPrimary: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  actionBtnTextPrimary: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  
  // Extra actions (test buttons, etc.)
  extraActions: {
    flexDirection: "row",
    gap: 16,
    marginTop: 12,
  },
  linkAction: {
    paddingVertical: 8,
  },
  linkActionText: {
    fontSize: 14,
    color: theme.colors.primary,
  },
  disconnectLink: {
    marginTop: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  disconnectText: {
    fontSize: 14,
    color: "#c62828",
  },
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
  activityLink: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e7eb",
    gap: 8,
  },
  activityLinkText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.primary,
  },
});
