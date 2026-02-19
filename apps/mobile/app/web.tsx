import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, View, ActivityIndicator, Pressable, Text } from "react-native";
import { WebView } from "react-native-webview";
import { useState, useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { useAuth } from "@/contexts/AuthContext";

export default function WebScreen() {
  const { url, title, successPattern, successRoute, refreshOnSuccess } = useLocalSearchParams<{
    url: string;
    title?: string;
    successPattern?: string;
    successRoute?: string;
    refreshOnSuccess?: string;
  }>();
  const router = useRouter();
  const { refreshMember } = useAuth();
  const [loading, setLoading] = useState(true);

  const resolvedUrl = url ? decodeURIComponent(url) : "";
  const resolvedSuccessPattern = successPattern ? decodeURIComponent(successPattern) : "";
  const resolvedSuccessRoute = successRoute ? decodeURIComponent(successRoute) : "";
  const shouldRefreshOnSuccess = refreshOnSuccess === "1";

  const onNavigationStateChange = useCallback(
    (nav: { url: string }) => {
      if (!resolvedSuccessPattern || !resolvedSuccessRoute) return;
      if (!nav.url.includes(resolvedSuccessPattern)) return;
      (async () => {
        if (shouldRefreshOnSuccess) {
          await refreshMember?.().catch(() => {});
        }
        router.replace(resolvedSuccessRoute as never);
      })();
    },
    [resolvedSuccessPattern, resolvedSuccessRoute, shouldRefreshOnSuccess, refreshMember, router]
  );

  if (!resolvedUrl) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
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
        source={{ uri: resolvedUrl }}
        style={styles.webview}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onNavigationStateChange={onNavigationStateChange}
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
    paddingTop: 48,
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
