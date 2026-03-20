import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { theme } from "@/lib/theme";
import { apiPost, apiGet, API_BASE } from "@/lib/api";

function parseShippoReturnUrl(url: string): { connected: boolean; error: string | null } {
  try {
    const parsed = Linking.parse(url);
    const q = parsed.queryParams ?? {};
    const connectedRaw = q.connected;
    const errRaw = q.oauth_error;
    const connected =
      connectedRaw === "shippo" ||
      (Array.isArray(connectedRaw) && connectedRaw[0] === "shippo");
    const errVal = Array.isArray(errRaw) ? errRaw[0] : errRaw;
    const error =
      typeof errVal === "string" && errVal.length > 0
        ? decodeURIComponent(errVal.replace(/\+/g, " "))
        : null;
    return { connected, error };
  } catch {
    return { connected: false, error: null };
  }
}

export default function ShippingSetupScreen() {
  const params = useLocalSearchParams<{ connected?: string; oauth_error?: string }>();
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const shipping = await apiGet<{ connected?: boolean }>("/api/shipping/status");
      const ok = Boolean(shipping.connected);
      setConnected(ok);
    } catch {
      setConnected(false);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshStatus();
    }, [refreshStatus])
  );

  React.useEffect(() => {
    const c = params.connected;
    const e = params.oauth_error;
    if (c === "shippo") {
      setSuccess(true);
      setError(null);
      void refreshStatus();
    }
    if (typeof e === "string" && e.length > 0) {
      setError(decodeURIComponent(e.replace(/\+/g, " ")));
      setSuccess(false);
    }
  }, [params.connected, params.oauth_error, refreshStatus]);

  const openShippoOAuth = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const { url } = await apiPost<{ url: string }>("/api/shipping/oauth-link", {});
      if (!url) {
        setError("Could not start Shippo connection.");
        return;
      }
      const returnUrl = `${API_BASE}/api/shipping/oauth-callback`;
      const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
      if (result.type === "success" && "url" in result && result.url) {
        const { connected: ok, error: err } = parseShippoReturnUrl(result.url);
        if (err) {
          setError(err);
          setSuccess(false);
        } else if (ok) {
          setSuccess(true);
          setError(null);
          await refreshStatus();
        } else {
          await refreshStatus();
        }
      }
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Could not connect to Shippo. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Set up Shippo</Text>
      <Text style={styles.hint}>
        Connect your Shippo account to buy shipping labels for store orders. Labels are charged to your Shippo
        account. After connecting, add at least one address in Shippo&apos;s Address Book (Settings → Addresses)
        so rates and labels work.
      </Text>

      {statusLoading ? (
        <ActivityIndicator style={styles.spinner} color={theme.colors.primary} />
      ) : connected ? (
        <View style={styles.bannerOk}>
          <Text style={styles.bannerOkText}>Shippo is connected.</Text>
          <Text style={styles.bannerHint}>Purchase labels from the website (Seller Hub → Orders).</Text>
        </View>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.primaryBtn,
          pressed && { opacity: 0.85 },
          (loading || connected) && styles.primaryBtnDisabled,
        ]}
        onPress={openShippoOAuth}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.primaryBtnText}>
            {connected ? "Reconnect Shippo" : "Connect with Shippo"}
          </Text>
        )}
      </Pressable>

      {success && !error && (
        <Text style={styles.success}>
          You&apos;re set. If you haven&apos;t already, add an address in Shippo&apos;s Address Book.
        </Text>
      )}
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  hint: { fontSize: 14, color: "#666", marginBottom: 24 },
  spinner: { marginVertical: 16 },
  bannerOk: {
    backgroundColor: "#e8f5e9",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  bannerOkText: { fontSize: 15, fontWeight: "600", color: "#2e7d32" },
  bannerHint: { fontSize: 13, color: "#666", marginTop: 6 },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  primaryBtnDisabled: { opacity: 0.65 },
  primaryBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  success: { color: "#2e7d32", marginTop: 16, fontSize: 14 },
  err: { color: "#c62828", marginTop: 16, fontSize: 14 },
});
