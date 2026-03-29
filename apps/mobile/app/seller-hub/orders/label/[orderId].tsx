import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  ActivityIndicator,
  Pressable,
  Text,
  Platform,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { useHubWebviewUri } from "@/lib/use-hub-webview-uri";
import { buildHubWebUrl } from "@/lib/seller-hub-web-url";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

/** Keep in sync with `NW_APP_WEBVIEW_MSG_SHIPPO_LABEL_SUCCESS` in apps/main `nw-app-webview-bridge.ts`. */
const NW_APP_MSG_SHIPPO_LABEL_SUCCESS = "nw_shippo_label_success";

function parseMode(raw: string | undefined): "reprint" | "purchase" | "another" {
  if (raw === "reprint" || raw === "another") return raw;
  return "purchase";
}

export default function SellerOrderShippoLabelScreen() {
  const { orderId, mode: modeParam } = useLocalSearchParams<{ orderId: string; mode?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const shippoLabelBackHandled = useRef(false);

  const mode = useMemo(() => parseMode(modeParam), [modeParam]);

  const targetUrl = useMemo(() => {
    if (!orderId) return "";
    return buildHubWebUrl(siteBase, `/seller-hub/orders/shippo/${orderId}`, {
      nwAppShippo: mode,
      nwAppChrome: true,
    });
  }, [orderId, mode]);

  const webViewUri = useHubWebviewUri(targetUrl);

  useEffect(() => {
    shippoLabelBackHandled.current = false;
  }, [webViewUri]);

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
        // ignore
      }
    },
    [router]
  );

  if (!orderId) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false, presentation: "fullScreenModal" }} />
        <View style={styles.fallback}>
          <Text style={styles.fallbackText}>Missing order.</Text>
          <Pressable style={styles.fallbackBtn} onPress={() => router.back()}>
            <Text style={styles.fallbackBtnText}>Go back</Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
          presentation: "fullScreenModal",
          animation: "slide_from_bottom",
        }}
      />
      <StatusBar style="dark" />
      <View style={styles.root}>
        {!webViewUri ? (
          <View style={styles.loadingFull}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : (
          <>
            <WebView
              source={{ uri: webViewUri }}
              style={styles.webview}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              onMessage={onWebViewMessage}
              androidLayerType="hardware"
            />
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              <View style={[styles.chrome, { paddingTop: Math.max(insets.top, 8) }]}>
                <Pressable
                  style={({ pressed }) => [styles.closeChip, pressed && { opacity: 0.85 }]}
                  onPress={() => router.back()}
                  accessibilityRole="button"
                  accessibilityLabel="Close shipping label"
                >
                  <Ionicons name="chevron-down" size={28} color="#1a1a1a" />
                </Pressable>
              </View>
            </View>
            {loading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
              </View>
            )}
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#fff",
  },
  webview: {
    flex: 1,
  },
  chrome: {
    paddingHorizontal: 10,
    paddingBottom: 8,
    alignItems: "flex-start",
  },
  closeChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.92)",
    justifyContent: "center",
    alignItems: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 3,
      },
      android: { elevation: 4 },
    }),
  },
  loadingFull: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.65)",
  },
  fallback: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  fallbackText: { fontSize: 16, color: "#666", marginBottom: 16 },
  fallbackBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
  },
  fallbackBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
