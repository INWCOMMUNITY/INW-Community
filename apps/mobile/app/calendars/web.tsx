import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, View, ActivityIndicator, Text, Pressable } from "react-native";
import { WebView } from "react-native-webview";
import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

export default function CalendarWebScreen() {
  const router = useRouter();
  const { url } = useLocalSearchParams<{ url: string; title?: string }>();
  const [loading, setLoading] = useState(true);

  const resolvedUrl = url ? decodeURIComponent(url) : "";

  if (!resolvedUrl) {
    return (
      <View style={styles.emptyContainer}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backRow, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.emptyTitle}>No page to open</Text>
        <Text style={styles.emptyBody}>
          A calendar link was not provided. Open a calendar from the app menu and try
          &quot;Open in browser&quot; again.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
  emptyContainer: {
    flex: 1,
    backgroundColor: "#ffffff",
    padding: 24,
    justifyContent: "center",
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 24,
  },
  backText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 8,
    fontFamily: theme.fonts.heading,
  },
  emptyBody: {
    fontSize: 15,
    color: theme.colors.text,
    lineHeight: 22,
  },
  pressed: {
    opacity: 0.75,
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
