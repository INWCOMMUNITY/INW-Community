import { useState } from "react";
import {
  StyleSheet,
  Pressable,
  TextInput,
  Text,
  View,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text as ThemedText, View as ThemedView } from "@/components/Themed";
import { theme } from "@/lib/theme";
import { signIn } from "@/lib/auth";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE } from "@/lib/api";
import type { SubscriptionPlan } from "@/lib/auth";

const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  subscribe: "Resident",
  sponsor: "Business",
  seller: "Seller",
};

function getApiHost(): string {
  try {
    const base = (API_BASE ?? "").trim();
    if (base) return new URL(base.replace(/\/$/, "") || "https://www.inwcommunity.com").hostname;
  } catch {
    // ignore
  }
  return "inwcommunity.com";
}

export default function SignInScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ plan?: string; isSignUp?: string; returnTo?: string }>();
  const { refreshMember } = useAuth();
  const plan = (params.plan as SubscriptionPlan) || "subscribe";
  const returnTo = params.returnTo as string | undefined;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const planLabel = PLAN_LABELS[plan];
  const signInUrl = `${(API_BASE ?? "").replace(/\/$/, "")}/api/auth/mobile-signin`;

  async function handleSignIn() {
    setError("");
    setErrorDetails(null);
    if (!email.trim() || !password) {
      setError("Email and password required");
      return;
    }
    setSigningIn(true);
    try {
      const meUrl = `${(API_BASE ?? "").replace(/\/$/, "")}/api/me`;
      const probeController = new AbortController();
      const probeTimeout = setTimeout(() => probeController.abort(), 10000);
      try {
        const probeRes = await fetch(meUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "INWCommunity/1.0 (com.northwestcommunity.app; iOS)",
          },
          signal: probeController.signal,
        });
        clearTimeout(probeTimeout);
        // Any response (e.g. 401) means server is reachable; proceed to sign-in.
      } catch (probeErr) {
        clearTimeout(probeTimeout);
        const msg = (probeErr as { message?: string }).message ?? String(probeErr);
        setErrorDetails(`Probe GET: ${meUrl}\nError: ${msg}`);
        setError(
          `Can't reach the server. Check Wi‑Fi or cellular — GET to server failed (${getApiHost()}).`
        );
        return;
      }

      await signIn(email.trim(), password, plan);
      await refreshMember();
      router.replace((returnTo ?? "/(tabs)/home") as import("expo-router").Href);
    } catch (e) {
      const err = e as { error?: string; status?: number; message?: string };
      const msg = err.error ?? err.message ?? "";
      const rawError = String(e);
      setErrorDetails(`URL: ${signInUrl}\nError: ${msg || rawError}`);

      const isNetworkError =
        err.status === 0 ||
        /network request failed|failed to fetch|timed out|unable to resolve|econnrefused/i.test(msg);

      if (isNetworkError) {
        const host = getApiHost();
        setError(
          `Can't reach the server (${host}). Check your connection — try Wi‑Fi if on cellular, or another network. If Safari can open inwcommunity.com, the app may need an update.`
        );
      } else if (err.status === 401) {
        setError("Invalid email or password.");
      } else if (msg) {
        setError(msg);
      } else {
        setError("Sign in failed");
      }
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Pressable style={styles.back} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.title}>Sign in as {planLabel}</Text>
        <Text style={styles.serverHint}>Server: {getApiHost()}</Text>
      </View>

      <ThemedView style={styles.form} lightColor="#fff" darkColor={theme.colors.secondary}>
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholderTextColor={theme.colors.placeholder}
          textContentType="emailAddress"
          autoComplete="email"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholderTextColor={theme.colors.placeholder}
          textContentType="password"
          autoComplete="password"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {errorDetails ? (
          <Text style={styles.errorDetails} selectable>
            {errorDetails}
          </Text>
        ) : null}
        <Pressable
          style={({ pressed }) => [
            styles.button,
            signingIn && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
          onPress={handleSignIn}
          disabled={signingIn}
        >
          {signingIn ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </Pressable>
      </ThemedView>

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    paddingTop: 48,
    backgroundColor: "#ffffff",
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  backText: {
    marginLeft: 8,
    fontSize: 16,
    color: theme.colors.primary,
    fontWeight: "600",
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  serverHint: {
    fontSize: 12,
    color: "#888",
    marginTop: 6,
  },
  form: {
    padding: 20,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#000",
    backgroundColor: theme.colors.primary,
  },
  input: {
    borderWidth: 2,
    borderColor: "#000",
    borderRadius: 4,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
    color: "#000",
    backgroundColor: "#fff",
  },
  error: {
    color: "#fff",
    marginBottom: 12,
    fontSize: 14,
  },
  errorDetails: {
    color: "rgba(255,255,255,0.9)",
    marginBottom: 12,
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  button: {
    backgroundColor: "#fff",
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonPressed: { opacity: 0.8 },
  buttonText: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: "600",
  },
});
