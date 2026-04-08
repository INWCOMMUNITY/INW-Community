import { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { API_BASE } from "@/lib/api";

function fetchHeadersJson(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(API_BASE.includes("inwcommunity.com")
      ? { Origin: "https://www.inwcommunity.com", Referer: "https://www.inwcommunity.com/" }
      : {}),
  };
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setMessage(null);
    if (!email.trim()) {
      setError("Enter your account email.");
      return;
    }
    setBusy(true);
    try {
      const url = `${API_BASE.replace(/\/$/, "")}/api/auth/forgot-password`;
      const res = await fetch(url, {
        method: "POST",
        headers: fetchHeadersJson(),
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok && data.error) {
        setError(data.error);
        return;
      }
      setMessage(
        typeof data.message === "string"
          ? data.message
          : "If that email is registered, we sent reset instructions.",
      );
      setEmail("");
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <Pressable
        style={styles.back}
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/signin");
        }}
      >
        <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <Text style={styles.title}>Forgot password</Text>
      <Text style={styles.body}>
        Enter the email for your account. We&apos;ll send a message with links to reset your password in the app or
        on the web.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={theme.colors.placeholder}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Pressable
        style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
        onPress={submit}
        disabled={busy}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send reset instructions</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 24,
    paddingTop: 48,
    backgroundColor: "#fff",
    flexGrow: 1,
  },
  back: { flexDirection: "row", alignItems: "center", marginBottom: 24 },
  backText: { marginLeft: 8, fontSize: 16, color: theme.colors.primary, fontWeight: "600" },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  body: { fontSize: 16, color: "#444", lineHeight: 24, marginBottom: 20 },
  input: {
    borderWidth: 2,
    borderColor: "#000",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    marginBottom: 12,
    color: theme.colors.heading,
    letterSpacing: 0,
  },
  error: { color: "#b91c1c", fontSize: 14, marginBottom: 8 },
  message: { color: "#14532d", fontSize: 14, marginBottom: 12, lineHeight: 20 },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
