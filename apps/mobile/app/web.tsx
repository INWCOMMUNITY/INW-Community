import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, View, ActivityIndicator, Pressable, Text, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useState, useCallback, useRef, useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { useAuth } from "@/contexts/AuthContext";
import { apiPost, setToken } from "@/lib/api";
import { useHubWebviewUri } from "@/lib/use-hub-webview-uri";

const AUTH_SCHEME = "inwcommunity://auth";

/** Keep in sync with `NW_APP_WEBVIEW_MSG_SHIPPO_LABEL_SUCCESS` in apps/main `nw-app-webview-bridge.ts`. */
const NW_APP_MSG_SHIPPO_LABEL_SUCCESS = "nw_shippo_label_success";

function parseTokenFromAuthUrl(url: string): string | null {
  if (!url.startsWith(AUTH_SCHEME)) return null;
  const match = url.match(/[?&]token=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function WebScreen() {
  const { url, title, successPattern, successRoute, refreshOnSuccess } = useLocalSearchParams<{
    url: string;
    title?: string;
    successPattern?: string;
    successRoute?: string;
    refreshOnSuccess?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshMember } = useAuth();
  const [loading, setLoading] = useState(true);
  const authHandled = useRef(false);
  const checkoutSuccessHandled = useRef(false);
  const shippoLabelBackHandled = useRef(false);

  const resolvedUrl = url ? decodeURIComponent(url) : "";
  const resolvedSuccessPattern = successPattern ? decodeURIComponent(successPattern) : "";
  const resolvedSuccessRoute = successRoute ? decodeURIComponent(successRoute) : "";
  const shouldRefreshOnSuccess = refreshOnSuccess === "1";

  const webViewUri = useHubWebviewUri(resolvedUrl);

  useEffect(() => {
    checkoutSuccessHandled.current = false;
    shippoLabelBackHandled.current = false;
  }, [resolvedUrl]);

  const runCheckoutSuccessRefresh = useCallback(async () => {
    if (checkoutSuccessHandled.current) return;
    checkoutSuccessHandled.current = true;
    await apiPost("/api/stripe/sync-subscriptions", {}).catch(() => {});
    await refreshMember?.().catch(() => {});
  }, [refreshMember]);

  const handleAuthRedirect = useCallback(
    async (targetUrl: string) => {
      const token = parseTokenFromAuthUrl(targetUrl);
      if (!token || authHandled.current) return;
      authHandled.current = true;
      try {
        await setToken(token);
        if (shouldRefreshOnSuccess) {
          await runCheckoutSuccessRefresh();
        }
        router.replace((resolvedSuccessRoute || "/(tabs)/home") as never);
      } catch {
        authHandled.current = false;
      }
    },
    [shouldRefreshOnSuccess, router, resolvedSuccessRoute, runCheckoutSuccessRefresh]
  );

  const onNavigationStateChange = useCallback(
    (nav: { url: string }) => {
      if (nav.url.startsWith(AUTH_SCHEME)) {
        handleAuthRedirect(nav.url);
        return;
      }
      if (!resolvedSuccessPattern || !resolvedSuccessRoute) return;
      if (!nav.url.includes(resolvedSuccessPattern)) return;
      (async () => {
        if (shouldRefreshOnSuccess) {
          await runCheckoutSuccessRefresh();
        }
        router.replace(resolvedSuccessRoute as never);
      })();
    },
    [resolvedSuccessPattern, resolvedSuccessRoute, shouldRefreshOnSuccess, router, handleAuthRedirect, runCheckoutSuccessRefresh]
  );

  const onShouldStartLoadWithRequest = useCallback(
    (request: { url: string }) => {
      if (request.url.startsWith(AUTH_SCHEME)) {
        handleAuthRedirect(request.url);
        return false;
      }
      return true;
    },
    [handleAuthRedirect]
  );

  const onWebViewMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data) as { type?: string };
        if (data?.type === NW_APP_MSG_SHIPPO_LABEL_SUCCESS && !shippoLabelBackHandled.current) {
          shippoLabelBackHandled.current = true;
          setTimeout(() => {
            router.back();
          }, 400);
        }
      } catch {
        // ignore non-JSON or unrelated messages
      }
    },
    [router]
  );

  if (!resolvedUrl) {
    return null;
  }

  if (!webViewUri) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title ? decodeURIComponent(title) : "Web"}
          </Text>
        </View>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title ? decodeURIComponent(title) : "Web"}
        </Text>
      </View>
      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      )}
      <WebView
        source={{ uri: webViewUri }}
        style={styles.webview}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onNavigationStateChange={onNavigationStateChange}
        onShouldStartLoadWithRequest={Platform.OS === "ios" ? onShouldStartLoadWithRequest : undefined}
        onMessage={onWebViewMessage}
        androidLayerType="hardware"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    backgroundColor: theme.colors.primary,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  loading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
    zIndex: 1,
  },
  webview: {
    flex: 1,
  },
});
