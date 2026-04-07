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

export default function VerifyEmailPendingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; plan?: string }>();
  const email =
    typeof params.email === "string" ? params.email : Array.isArray(params.email) ? params.email[0] : "";
  const planParam =
    typeof params.plan === "string" ? params.plan : Array.isArray(params.plan) ? params.plan[0] : "subscribe";

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  async function verify() {
    setError(null);
    setResendMessage(null);
    if (!email?.trim()) {
      setError("Email is missing. Go back and sign up again.");
      return;
    }
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    try {
      const url = `${API_BASE.replace(/\/$/, "")}/api/auth/verify-email-code`;
      const res = await fetch(url, {
        method: "POST",
        headers: fetchHeadersJson(),
        body: JSON.stringify({ email: email.trim(), code }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not verify. Try again.");
        return;
      }
      router.replace({
        pathname: "/signin",
        params: {
          plan: planParam,
          emailVerified: "1",
          returnTo: "/(tabs)/my-community",
        },
      } as never);
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!email?.trim()) return;
    setResendMessage(null);
    setError(null);
    setResendBusy(true);
    try {
      const url = `${API_BASE.replace(/\/$/, "")}/api/auth/resend-verification`;
      const res = await fetch(url, {
        method: "POST",
        headers: fetchHeadersJson(),
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      setResendMessage(
        typeof data.message === "string" ? data.message : "If that email is registered, we sent a code.",
      );
    } catch {
      setResendMessage("Could not send. Try again in a minute.");
    } finally {
      setResendBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <Pressable
        style={styles.back}
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/login");
        }}
      >
        <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <Text style={styles.title}>Verify your email</Text>
      <Text style={styles.body}>
        We sent a 6-digit code to <Text style={styles.em}>{email?.trim() || "your email"}</Text>. Enter it below to
        finish sign up—then sign in.
      </Text>

      <TextInput
        style={styles.codeInput}
        placeholder="000000"
        placeholderTextColor={theme.colors.placeholder}
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={14}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
        onPress={verify}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>Verify email</Text>
        )}
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.9 }]}
        onPress={resend}
        disabled={resendBusy || !email?.trim()}
      >
        {resendBusy ? (
          <ActivityIndicator color={theme.colors.primary} />
        ) : (
          <Text style={styles.secondaryBtnText}>Resend code</Text>
        )}
      </Pressable>

      {resendMessage ? <Text style={styles.message}>{resendMessage}</Text> : null}
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
  em: { fontWeight: "600", color: theme.colors.heading },
  codeInput: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 22,
    letterSpacing: 4,
    fontVariant: ["tabular-nums"],
    marginBottom: 12,
    color: theme.colors.heading,
  },
  error: { color: "#b91c1c", fontSize: 14, marginBottom: 8 },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryBtn: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  secondaryBtnText: { color: theme.colors.primary, fontSize: 16, fontWeight: "600" },
  message: { marginTop: 16, fontSize: 14, color: "#555", textAlign: "center" },
});
