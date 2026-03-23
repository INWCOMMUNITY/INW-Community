import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, View, ActivityIndicator, Pressable, Text, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useState, useCallback, useRef, useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE, apiPost, setToken } from "@/lib/api";
import {
  isHubWebviewBridgePath,
  sameOriginPathFromUrl,
  siteOriginFromApiBase,
} from "@/lib/app-webview-params";

const AUTH_SCHEME = "inwcommunity://auth";

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
  const [webViewUri, setWebViewUri] = useState<string | null>(null);
  const authHandled = useRef(false);

  const resolvedUrl = url ? decodeURIComponent(url) : "";
  const resolvedSuccessPattern = successPattern ? decodeURIComponent(successPattern) : "";
  const resolvedSuccessRoute = successRoute ? decodeURIComponent(successRoute) : "";
  const shouldRefreshOnSuccess = refreshOnSuccess === "1";

  useEffect(() => {
    if (!resolvedUrl) {
      setWebViewUri(null);
      return;
    }
    const origin = siteOriginFromApiBase(API_BASE);
    const path = sameOriginPathFromUrl(resolvedUrl, origin);
    if (!path || !isHubWebviewBridgePath(path.split("#")[0] ?? "")) {
      setWebViewUri(resolvedUrl);
      return;
    }
    let cancelled = false;
    const nextPath = path.split("#")[0];
    (async () => {
      try {
        const data = await apiPost<{ redirectUrl?: string }>("/api/auth/webview-bridge", {
          next: nextPath,
        });
        if (!cancelled && data.redirectUrl) {
          setWebViewUri(data.redirectUrl);
          return;
        }
      } catch {
        // fall through to direct URL (user may need to sign in on web)
      }
      if (!cancelled) setWebViewUri(resolvedUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [resolvedUrl]);

  const handleAuthRedirect = useCallback(
    async (targetUrl: string) => {
      const token = parseTokenFromAuthUrl(targetUrl);
      if (!token || authHandled.current) return;
      authHandled.current = true;
      try {
        await setToken(token);
        if (shouldRefreshOnSuccess) {
          await refreshMember?.().catch(() => {});
        }
        router.replace((resolvedSuccessRoute || "/(tabs)/home") as never);
      } catch {
        authHandled.current = false;
      }
    },
    [shouldRefreshOnSuccess, refreshMember, router, resolvedSuccessRoute]
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
          await refreshMember?.().catch(() => {});
        }
        router.replace(resolvedSuccessRoute as never);
      })();
    },
    [resolvedSuccessPattern, resolvedSuccessRoute, shouldRefreshOnSuccess, refreshMember, router, handleAuthRedirect]
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
