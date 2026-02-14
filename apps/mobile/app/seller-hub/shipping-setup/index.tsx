import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { apiPost } from "@/lib/api";

const EASYPOST_LOGIN = "https://www.easypost.com/users/sign_in";
const EASYPOST_API_KEYS = "https://www.easypost.com/account/api-keys";

export default function ShippingSetupScreen() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openUrl = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  const handleSave = async () => {
    const key = apiKey.trim();
    if (!key) {
      setError("API key is required");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await apiPost<{ connected: boolean }>("/api/shipping/connect", { apiKey: key });
      setSuccess("EasyPost connected. You can get rates and buy labels.");
      setApiKey("");
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Set Up EasyPost</Text>
      <Text style={styles.hint}>
        Connect your EasyPost account for shipping labels. You pay for labels with your own card.
      </Text>

      <Text style={styles.step}>Step 1–2: Get your API key</Text>
      <Pressable
        style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.8 }]}
        onPress={() => openUrl(EASYPOST_LOGIN)}
      >
        <Text style={styles.linkText}>Log in to EasyPost</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.8 }]}
        onPress={() => openUrl(EASYPOST_API_KEYS)}
      >
        <Text style={styles.linkText}>Open API Keys page</Text>
      </Pressable>

      <Text style={styles.step}>Step 3: Paste your API key</Text>
      <TextInput
        style={styles.input}
        placeholder="Paste EasyPost API key"
        placeholderTextColor={theme.colors.placeholder}
        value={apiKey}
        onChangeText={setApiKey}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />
      <Pressable
        style={({ pressed }) => [
          styles.saveBtn,
          pressed && { opacity: 0.8 },
          loading && styles.saveBtnDisabled,
        ]}
        onPress={handleSave}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.saveBtnText}>Save & connect</Text>
        )}
      </Pressable>

      {success && <Text style={styles.success}>{success}</Text>}
      {error && <Text style={styles.err}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  hint: { fontSize: 14, color: "#666", marginBottom: 24 },
  step: { fontSize: 16, fontWeight: "600", marginBottom: 8, color: "#333" },
  linkBtn: {
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.creamAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.cream,
  },
  linkText: { fontSize: 15, color: theme.colors.primary, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  saveBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  success: { color: "#2e7d32", marginTop: 16, fontSize: 14 },
  err: { color: "#c62828", marginTop: 16, fontSize: 14 },
});
