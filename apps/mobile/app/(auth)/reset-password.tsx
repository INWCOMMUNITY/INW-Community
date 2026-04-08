import { useState, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
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

function tokenFromParams(raw: string | string[] | undefined): string {
  if (raw == null) return "";
  const s = typeof raw === "string" ? raw : raw[0];
  return (s ?? "").trim();
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const urlToken = useMemo(() => tokenFromParams(params.token), [params.token]);
  const [pasteToken, setPasteToken] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveToken = (urlToken || pasteToken).trim();

  async function submit() {
    setError(null);
    if (!effectiveToken) {
      setError("Open this screen from the link in your email, or paste the reset token from the link.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== password2) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const url = `${API_BASE.replace(/\/$/, "")}/api/auth/reset-password`;
      const res = await fetch(url, {
        method: "POST",
        headers: fetchHeadersJson(),
        body: JSON.stringify({ token: effectiveToken, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not reset password.");
        return;
      }
      router.replace({
        pathname: "/signin",
        params: { passwordReset: "1" },
      } as never);
    } catch {
      setError("Could not reach the server. Try again.");
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

      <Text style={styles.title}>Choose a new password</Text>
      <Text style={styles.body}>
        Enter your new password twice. After saving, sign in with the email for this account.
      </Text>

      {!urlToken ? (
        <View style={styles.tokenBox}>
          <Text style={styles.tokenLabel}>Reset token (from email link, the part after token=)</Text>
          <TextInput
            style={styles.input}
            placeholder="Paste token if the link didn’t open the app"
            placeholderTextColor={theme.colors.placeholder}
            value={pasteToken}
            onChangeText={setPasteToken}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      ) : null}

      <TextInput
        style={styles.input}
        placeholder="New password (min 8 characters)"
        placeholderTextColor={theme.colors.placeholder}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password-new"
        textContentType="newPassword"
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm new password"
        placeholderTextColor={theme.colors.placeholder}
        value={password2}
        onChangeText={setPassword2}
        secureTextEntry
        autoComplete="password-new"
        textContentType="newPassword"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
        onPress={submit}
        disabled={busy}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Update password</Text>}
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
  body: { fontSize: 16, color: "#444", lineHeight: 24, marginBottom: 16 },
  tokenBox: { marginBottom: 12 },
  tokenLabel: { fontSize: 13, color: "#555", marginBottom: 6 },
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
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
